#!/usr/bin/env python3
"""Offline evidence pipeline. Raw TSV -> audited, clustered daily summaries.
Run --audit first, then --transport, then --access. No GPS used as passenger data.
"""
import argparse, csv, datetime as dt, hashlib, heapq, json, math, pathlib, random, statistics
from collections import Counter, defaultdict
from prepare_transport import decode, distance, bearing, StopIndex

ROOT=pathlib.Path(__file__).resolve().parents[1]; RAW=ROOT/'raw'; OUT=ROOT/'dist/data/mobility'
OUT.mkdir(parents=True,exist_ok=True); CACHE=RAW/'mobility';CACHE.mkdir(exist_ok=True)
BOUNDS=json.loads((ROOT/'dist/data/terrain.json').read_text())['bounds']
STOPS=json.loads((ROOT/'dist/data/transport/stops.json').read_text())['stops']
INDEX=StopIndex(STOPS,BOUNDS); MX=111320*math.cos(math.radians((BOUNDS[1]+BOUNDS[3])/2))
MOSCOW=dt.timezone(dt.timedelta(hours=3)); PERIODS={'утро':(7,10),'день':(10,16),'вечерний пик':(16,19),'поздний вечер':(19,21)}
DATES=[(dt.date(2026,9,14)+dt.timedelta(days=i)).isoformat() for i in range(24)]
WEIGHTS={'benefit':.25,'safety':.25,'accessibility':.20,'feasibility':.15,'evidence':.15}
def write(p,x):p.write_text(json.dumps(x,ensure_ascii=False,separators=(',',':'),allow_nan=False))
def quantile(a,q):
    if not a:return None
    a=sorted(a);k=(len(a)-1)*q;i=int(k);return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(k-i)
def rounded(x):return round(x,3) if isinstance(x,float) else x
def cell(lon,lat):return math.floor((lon-BOUNDS[0])*MX/250),math.floor((lat-BOUNDS[1])*111320/250)
def center(x,y):return BOUNDS[0]+(x+.5)*250/MX,BOUNDS[1]+(y+.5)*250/111320
def xy(p):return ((p[0]-BOUNDS[0])*MX,(p[1]-BOUNDS[1])*111320)
def period(t):
    return next((k for k,(a,b) in PERIODS.items() if a*3600<=t<b*3600),None)
def stats(h):
    if not h:return None
    mean=statistics.mean(h);return {'n':len(h),'median':rounded(statistics.median(h)),'p90':rounded(quantile(h,.9)),
      'mean':rounded(mean),'cv':rounded(statistics.pstdev(h)/mean) if mean else None,
      'wait':rounded(sum(v*v for v in h)/(2*sum(h))) if sum(h) else None,
      'bunches':sum(v<=2 for v in h),'longGaps':sum(v>=max(15,2*statistics.median(h)) for v in h)}
def cluster_ci(groups,fn,seed=20261009):
    """Whole-day bootstrap: preserves vehicle dependence within each day."""
    groups=list(groups)
    if len(groups)<5:return None
    rng=random.Random(seed); draws=[fn([x for g in rng.choices(groups,k=len(groups)) for x in g]) for _ in range(300)]
    return [rounded(quantile(draws,.025)),rounded(quantile(draws,.975))]
def timestamp(s):
    # Verified d.m.Y format, no locale or host timezone dependency.
    return int(dt.datetime(int(s[6:10]),int(s[3:5]),int(s[:2]),int(s[11:13]),int(s[14:16]),int(s[17:19]),tzinfo=MOSCOW).timestamp())
def read_day(date):
    p=RAW/('transport-'+date+'.csv');midnight=int(dt.datetime.fromisoformat(date).replace(tzinfo=MOSCOW).timestamp())
    counts=Counter();speed=Counter();offset=Counter();dedup={};columns=None;encoded=0
    with p.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f,delimiter='\t');columns=reader.fieldnames
        for r in reader:
            counts['rawRows']+=1;speed[r.get('speed','')]+=1
            try:
                lon,lat=decode(r['lon'],r['lat']);t=timestamp(r['lasttime']);collected=int(float(r['created_at']))
                if not math.isfinite(lon+lat) or not (-180<=lon<=180 and -90<=lat<=90):raise ValueError()
                if not r['rid'] or not r['id_api']:raise ValueError()
                encoded+=abs(float(r['lon']))>180
                offset[round((collected-t)/60)]+=1
                if not midnight<=t<midnight+86400:counts['outsideFileDate']+=1;continue
                if not (BOUNDS[0]<=lon<=BOUNDS[2] and BOUNDS[1]<=lat<=BOUNDS[3]):counts['outsideMap']+=1;continue
                key=(r['id_api'],r['rid'],t);row=(collected,t-midnight,lon,lat,r['big_jump']=='1',r['rtype']+':'+r['rnum'])
                if key in dedup:
                    counts['duplicates']+=1
                    if dedup[key][2:4]!=row[2:4]:counts['duplicateCoordinateConflicts']+=1
                if key not in dedup or collected>=dedup[key][0]:dedup[key]=row
            except (ValueError,KeyError,OverflowError,IndexError):counts['invalidRows']+=1
    tracks=defaultdict(list)
    for (vid,rid,t),row in dedup.items():tracks[(vid,rid,row[5])].append(row[1:5])
    return tracks,{'date':date,'columns':columns,'counts':dict(counts),'speedValues':speed.most_common(10),
          'encodedCoordinateRows':encoded,'collectionOffsetMinutes':offset.most_common(5),
          'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'source':'https://huggingface.co/datasets/daniilakk/cheboksary-public-transport-gps-daily/blob/main/transport/'+date+'.csv'}
def audit_day(date):
    tracks,audit=read_day(date);q=Counter(audit['counts']);hours=[{'bins':set(),'vehicles':set(),'routes':set(),'points':0} for _ in range(24)]
    rh=defaultdict(lambda:{'bins':set(),'vehicles':set(),'points':0});gaps=[];speeds=[];cells=set();start=86400;end=0
    segments=[];events=[]
    for (vid,rid,route),rows in tracks.items():
        rows.sort();prev=None;last_stop=None;direction=None
        for t,lon,lat,jump in rows:
            h=t//3600;b=t//300;start=min(start,t);end=max(end,t);cells.add(cell(lon,lat))
            hours[h]['bins'].add(b);hours[h]['vehicles'].add(vid);hours[h]['routes'].add(route);hours[h]['points']+=1
            z=rh[(route,h)];z['bins'].add(b);z['vehicles'].add(vid);z['points']+=1
            valid=False
            if prev:
                gap=t-prev[0];meters=distance(prev[1:3],(lon,lat));v=meters/gap*3.6 if gap else math.inf;gaps.append(gap)
                if gap>180:q['gapsOver180']+=1
                if gap<15:q['shortSegments']+=1
                if v>120:q['implausibleSpeed']+=1
                if jump or prev[3]:q['flaggedJumpSegments']+=1
                valid=15<=gap<=180 and v<=120 and not jump and not prev[3]
                if valid:
                    q['validSegments']+=1;speeds.append(v)
                    if meters>5:direction=((bearing(prev[1:3],(lon,lat))+45)%360)//90
                    near=INDEX.nearest((lon+prev[1])/2,(lat+prev[2])/2)
                    # midpoint attribution only; not a map-matched official road segment
                    x,y=cell((lon+prev[1])/2,(lat+prev[2])/2)
                    segments.append([route,rid,vid,t,gap,meters,x,y,direction,near])
                else:q['rejectedSegments']+=1
            nearest=INDEX.nearest(lon,lat)
            if nearest is not None and valid and direction is not None and nearest!=last_stop:
                s=STOPS[nearest]
                if distance(prev[1:3],(s['lon'],s['lat']))>70:events.append([nearest,route,rid,direction,t,vid])
            if nearest is not None:last_stop=nearest
            elif last_stop is not None:
                s=STOPS[last_stop]
                if distance((lon,lat),(s['lon'],s['lat']))>110:last_stop=None
            prev=t,lon,lat,jump
    audit.update(counts=dict(q),points=sum(len(r) for r in tracks.values()),vehicles=len({k[0] for k in tracks}),routes=len({k[2] for k in tracks}),
      start=start,end=end,gapSeconds={'p10':quantile(gaps,.1),'median':quantile(gaps,.5),'p90':quantile(gaps,.9)},
      derivedSpeedKmh={'median':quantile(speeds,.5),'p90':quantile(speeds,.9)},territoryCells=[list(c) for c in sorted(cells)],
      hours=[{'hour':h,'points':v['points'],'vehicles':len(v['vehicles']) if v['points'] else None,'routes':len(v['routes']) if v['points'] else None,'coverage':len(v['bins'])/12} for h,v in enumerate(hours)],
      routeHours=[{'route':r,'hour':h,'points':v['points'],'vehicles':len(v['vehicles']),'coverage':len(v['bins'])/12,'bins':sorted(v['bins'])} for (r,h),v in sorted(rh.items())])
    write(CACHE/(date+'.json'),{'audit':audit,'segments':segments,'events':events})
    print(date,{k:audit[k] for k in ['points','vehicles','routes','gapSeconds']},flush=True)
    return audit
def audit_all():
    audits=[]
    for date in DATES:
        if not (RAW/('transport-'+date+'.csv')).exists():continue
        p=CACHE/(date+'.json');audits.append(json.loads(p.read_text())['audit'] if p.exists() else audit_day(date))
    tree=json.loads((RAW/'archive-tree.json').read_text());available=sorted(x['path'].split('/')[-1][:-4] for x in tree if x['path'].endswith('.csv'))
    missing=[]
    for a,b in zip(available,available[1:]):
        gap=(dt.date.fromisoformat(b)-dt.date.fromisoformat(a)).days-1
        if gap:missing.append({'after':a,'before':b,'missingDays':gap})
    write(OUT/'audit.json',{'version':1,'asOf':'2026-10-09','bounds':BOUNDS,'archive':{'availableFiles':len(available),'first':available[0],'last':available[-1],'gaps':missing},
      'days':audits,'method':{'encoding':'UTF-8, TSV despite .csv extension','clock':'lasttime Europe/Moscow; created_at diagnostic only',
      'coordinates':'lon=int(raw_lon+3962591)/1800000; lat=int(raw_lat+3193782)/1200000; decimal degree rows preserved',
      'speed':'Displacement / elapsed GPS time. Source speed checked, not used.','dedup':'id_api + rid + lasttime, latest created_at retained',
      'maxGapSeconds':180,'minGapSeconds':15,'maxSpeedKmh':120,'gridMeters':250,'coverage':'Share of 5-minute bins with observations; does not prove all vehicles are tracked.'}})
    return audits
def eligible(a):return all(a['hours'][h]['coverage']>=.9 for h in range(7,21))
def transport():
    audits=json.loads((OUT/'audit.json').read_text())['days'];keep={a['date'] for a in audits if eligible(a) and a['date']<='2026-10-04'}
    route_set={a['date']:{r['route'] for r in a['routeHours'] if 7<=r['hour']<21 and r['coverage']>=.9 and r['vehicles']>=3} for a in audits if a['date'] in keep}
    # Match route composition across compared days; require full hourly coverage per route.
    common=set.intersection(*(route_set.values())) if route_set else set()
    cells=defaultdict(lambda:defaultdict(list));head=defaultdict(lambda:defaultdict(list));daily=[];segments_table=[]
    for a in audits:
        date=a['date'];d=json.loads((CACHE/(date+'.json')).read_text());kind='выходной' if dt.date.fromisoformat(date).weekday()>=5 else 'будний'
        coverage={(r['route'],r['hour']):r for r in a['routeHours']}
        source_bins=defaultdict(set)
        for route,rid,vid,t,*_ in d['segments']:source_bins[rid].add(t//300)
        active=defaultdict(set);route_stats=defaultdict(list);hour_stats=defaultdict(list)
        for route,rid,vid,t,seconds,meters,x,y,direction,near in d['segments']:
            if not 7*3600<=t-seconds<t<21*3600:continue
            route_stats[route].append((seconds,meters));hour_stats[t//3600].append((seconds,meters));active[t//300].add(vid)
            pr=period(t)
            if date not in keep or route not in common or not pr or direction is None:continue
            lo,hi=PERIODS[pr]
            if not all(coverage.get((route,h),{}).get('coverage',0)>=.9 for h in range(lo,hi)):continue
            # Compare near-stop and between-stop evidence separately.
            cells[(x,y,route,direction,kind,pr,'у остановки' if near is not None else 'между остановками')][date].append((seconds,meters,vid))
        daily.append({'date':date,'kind':kind,'eligible':date in keep,'routesInCommon':len(common & route_set.get(date,set())),
          'hours':[{'hour':h,'seconds':sum(v[0] for v in hour_stats[h]),'speed':sum(v[1] for v in hour_stats[h])/sum(v[0] for v in hour_stats[h])*3.6 if hour_stats[h] else None,'peakVehicles':max([len(active[b]) for b in range(h*12,(h+1)*12)],default=0) if a['hours'][h]['points'] else None} for h in range(7,21)],
          'routes':[{'route':r,'hours':sum(v[0] for v in vs)/3600,'speed':sum(v[1] for v in vs)/sum(v[0] for v in vs)*3.6} for r,vs in sorted(route_stats.items())]})
        groups=defaultdict(list)
        for s,r,rid,di,t,vid in d['events']:
            pr=period(t)
            if pr and date in keep and r in common:groups[(s,r,rid,di,kind,pr)].append((t,vid))
        for key,ev in groups.items():
            s,r,rid,di,kind,pr=key;lo,hi=PERIODS[pr]
            if not all(coverage.get((r,h),{}).get('coverage',0)>=.9 for h in range(lo,hi)):continue
            ev=sorted(set(ev));hs=[];censored=0
            bins=source_bins[rid]
            if any(sum(b in bins for b in range(h*12,(h+1)*12))/12<.9 for h in range(lo,hi)):continue
            for (t1,v1),(t2,v2) in zip(ev,ev[1:]):
                if v1==v2:continue
                if t2-t1>3600 or any(b not in bins for b in range(t1//300,t2//300+1)):censored+=1;continue
                hs.append((t2-t1)/60)
            head[key][date]={'h':hs,'censored':censored,'visits':len(ev),'vehicles':len({v for _,v in ev})}
    for key,days in cells.items():
        if len(days)<3:continue
        flat=[v for vs in days.values() for v in vs];seconds=sum(v[0] for v in flat);meters=sum(v[1] for v in flat)
        if seconds<1800 or len({v[2] for v in flat})<5:continue
        perday=[sum(v[1] for v in vs)/sum(v[0] for v in vs)*3.6 for vs in days.values()];x,y,route,di,kind,pr,loc=key
        # Cluster day speed distributions, never iid-GPS confidence intervals.
        ci=cluster_ci([[(sum(v[0] for v in vs),sum(v[1] for v in vs))] for vs in days.values()],lambda vs:sum(v[1] for v in vs)/sum(v[0] for v in vs)*3.6)
        segments_table.append({'lon':center(x,y)[0],'lat':center(x,y)[1],'cell':[x,y],'route':route,'direction':di,'kind':kind,'period':pr,'location':loc,
          'speed':rounded(meters/seconds*3.6),'p10':rounded(quantile([v[1]/v[0]*3.6 for v in flat],.1)),
          'median':rounded(quantile([v[1]/v[0]*3.6 for v in flat],.5)),'p90':rounded(quantile([v[1]/v[0]*3.6 for v in flat],.9)),
          'slowShare':rounded(sum(v[0] for v in flat if v[1]/v[0]*3.6<5)/seconds),'seconds':seconds,'n':len(flat),'vehicles':len({v[2] for v in flat}),
          'days':sorted(days),'slowDays':sum(v<12 for v in perday),'daySpeedRange':[rounded(min(perday)),rounded(max(perday))],'speedCI':ci})
    intervals=[]
    for (s,r,rid,di,kind,pr),days in head.items():
        hs=[h for v in days.values() for h in v['h']]
        if len(hs)<3:continue
        row=stats(hs);row.update(stop=s,route=r,sourceRoute=rid,direction=di,kind=kind,period=pr,days=sorted(days),
          visits=sum(v['visits'] for v in days.values()),censored=sum(v['censored'] for v in days.values()),
          medianCI=cluster_ci([v['h'] for v in days.values() if v['h']],lambda x:statistics.median(x)),
          waitCI=cluster_ci([[(sum(h*h for h in v['h']),sum(v['h']))] for v in days.values() if v['h']],lambda x:sum(v[0] for v in x)/(2*sum(v[1] for v in x)) if sum(v[1] for v in x) else 0),
          dayMedians=[{'date':date,'median':stats(v['h'])['median'],'n':len(v['h'])} for date,v in sorted(days.items()) if v['h']])
        intervals.append(row)
    intervals.sort(key=lambda v:(-len(v['days']),-v['n']))
    segments_table.sort(key=lambda v:(v['speed'],-len(v['days'])))
    result={'version':1,'selection':{'weeks':['2026-09-14/2026-09-20','2026-09-21/2026-09-27','2026-09-28/2026-10-04'],
      'eligibleDays':sorted(keep),'excludedDays':[a['date'] for a in audits if a['date'] not in keep],
      'commonRoutes':sorted(common),'criterion':'Each citywide hour 07–21 has >=90% observed 5-minute bins. Each route/period separately >=90%; headways also require >=90% bins per source rid, >=3 vehicles in at least one hour. Common route set across eligible days. Weekdays and weekends separate.'},
      'daily':daily,'segments':segments_table,'intervals':intervals,
      'limits':['Intervals are observed entries, not boarding times or complete service headways; route gaps censored, terminal/turning geometry and missed radius entries remain.',
      'Time-weighted speed includes dwell. Near stop = midpoint within 70 m of catalog; GPS frequency cannot identify door-open dwell or split a crossing delay from stop dwell.',
      'CI: percentile bootstrap of entire days (300 draws, seed 20261009), at least 5 nonempty days. Dependence within vehicles/days retained; correlated days and tracking bias not removed.',
      'P10/P50/P90 speeds describe unweighted observed segments; aggregate mean/slow share are weighted by time. These are 250 m GPS cells, not official map-matched road links.',
      'Bunching proxy: H<=2 min. Long gap: H>=max(15 min, 2*group median). Intervals >60 min or crossing a missing route bin are censored; this biases tails downward.',
      'E(W)=sum(H²)/(2 sum(H)) assumes random independent passenger arrival and representative headways. It is only an observed-interval scenario; passenger counts are unavailable.']}
    write(OUT/'transport.json',result);print('Transport',len(keep),'days',len(common),'common routes',len(segments_table),'cells',len(intervals),'interval groups')
    export_csv('daily',daily,['date','kind','eligible','routesInCommon'])
    export_csv('segments',segments_table)
    export_csv('intervals',[dict(v,stopName=STOPS[v['stop']]['name'],lon=STOPS[v['stop']]['lon'],lat=STOPS[v['stop']]['lat']) for v in intervals])
def export_csv(name,rows,keys=None):
    if not rows:return
    keys=keys or list(rows[0]);p=OUT/(name+'.csv')
    with p.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore',delimiter=';');w.writeheader()
        for row in rows:w.writerow({k:json.dumps(row[k],ensure_ascii=False) if isinstance(row.get(k),(list,dict)) else row.get(k) for k in keys})

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--audit',action='store_true');ap.add_argument('--transport',action='store_true');args=ap.parse_args()
    if args.audit:audit_all()
    if args.transport:transport()
