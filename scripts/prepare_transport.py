#!/usr/bin/env python3
"""Reproducible, stdlib-only GPS/stops import. Raw downloads stay outside dist.
Coordinates follow buscheb.ru's public client, not the dataset's inaccurate
'decimal degrees' description. API lasttime is the observation clock (Moscow).
"""
import argparse, csv, datetime as dt, hashlib, json, math, pathlib, urllib.request
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = 'daniilakk/cheboksary-public-transport-gps-daily'
BASE = 'https://huggingface.co/datasets/' + REPO + '/resolve/main/'
STOPS_URL = 'https://buscheb.ru/php/getStations.php?city=cheboksari'
MOSCOW = dt.timezone(dt.timedelta(hours=3))
MAX_GAP = 180
MAX_SPEED = 120

def decode(lon, lat):
    lon, lat = float(lon), float(lat)
    if abs(lon) <= 180 and abs(lat) <= 90:
        return lon, lat
    return (int(lon + 3962591) / 1800000, int(lat + 3193782) / 1200000)

def distance(a, b):
    p, q = math.radians(a[1]), math.radians(b[1])
    dlat, dlon = q-p, math.radians(b[0]-a[0])
    h = math.sin(dlat/2)**2 + math.cos(p)*math.cos(q)*math.sin(dlon/2)**2
    return 12742000 * math.asin(math.sqrt(min(1, h)))

def bearing(a, b):
    p,q=math.radians(a[1]),math.radians(b[1]); d=math.radians(b[0]-a[0])
    return round(math.degrees(math.atan2(math.sin(d)*math.cos(q),math.cos(p)*math.sin(q)-math.sin(p)*math.cos(q)*math.cos(d)))%360)

def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False))

def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, path)

class StopIndex:
    def __init__(self, stops, bounds):
        self.w,self.s = bounds[:2]; self.mx=111320*math.cos(math.radians((bounds[1]+bounds[3])/2)); self.cells={}; self.stops=stops
        for i,s in enumerate(stops):
            if s['inMap'] and s['type']=='0':self.cells.setdefault(self.cell(s['lon'],s['lat']),[]).append(i)
    def cell(self, lon, lat):return (math.floor((lon-self.w)*self.mx/100),math.floor((lat-self.s)*111320/100))
    def nearest(self, lon, lat):
        x,y=self.cell(lon,lat); best=None;d=70
        for xx in range(x-1,x+2):
            for yy in range(y-1,y+2):
                for i in self.cells.get((xx,yy),[]):
                    s=self.stops[i];v=distance((lon,lat),(s['lon'],s['lat']))
                    if v<d:best=i;d=v
        return best

def prepare_day(date, path, bounds, stops):
    midnight=int(dt.datetime.fromisoformat(date).replace(tzinfo=MOSCOW).timestamp())
    counters=Counter(); dedup={};offsets=Counter()
    with path.open(newline='') as f:
        for r in csv.DictReader(f,delimiter='\t'):
            counters['rawRows']+=1
            try:
                lon,lat=decode(r['lon'],r['lat'])
                timestamp=int(dt.datetime.strptime(r['lasttime'],'%d.%m.%Y %H:%M:%S').replace(tzinfo=MOSCOW).timestamp())
                if not (bounds[0]<=lon<=bounds[2] and bounds[1]<=lat<=bounds[3]):counters['outsideMap']+=1;continue
                if not r['id_api'] or not r['rid']:raise ValueError('missing identity')
                key=(r['id_api'],r['rid'],timestamp)
                if key in dedup:counters['duplicates']+=1
                collected=int(float(r['created_at'])); offsets[round((collected-timestamp)/3600)]+=1
                # Preserve last observation for repeated identical GPS timestamps.
                if key not in dedup or collected>=dedup[key][0]:dedup[key]=(collected,r,lon,lat)
            except (ValueError,KeyError,OverflowError):counters['invalidRows']+=1
    grouped={}
    for (vid,rid,t),(_,r,lon,lat) in dedup.items():
        key=(vid,rid)
        if key not in grouped:grouped[key]={'id':vid,'route':r['rtype']+':'+r['rnum'],'sourceRoute':rid,'number':r['rnum'],'type':r['rtype'],'lowFloor':r['low_floor']=='1','rows':[]}
        grouped[key]['rows'].append((t,lon,lat,r['big_jump']=='1'))
    index=StopIndex(stops,bounds);tracks=[];start=math.inf;end=-math.inf
    for tr in grouped.values():
        rows=sorted(tr.pop('rows')); points=[];events=[];prev=None;last_stop=None;direction=0
        for t,lon,lat,jump in rows:
            start=min(start,t);end=max(end,t);speed=None;valid=False
            if prev:
                gap=t-prev[0];meters=distance(prev[1:3],(lon,lat));v=meters/gap*3.6 if gap else math.inf
                valid=15<=gap<=MAX_GAP and v<=MAX_SPEED and not jump and not prev[3]
                if valid:
                    speed=round(v,1);counters['validSegments']+=1
                    if meters>5:direction=bearing(prev[1:3],(lon,lat))
                else:counters['rejectedSegments']+=1
            nearest=index.nearest(lon,lat)
            if nearest is not None and valid and nearest!=last_stop:
                s=stops[nearest]
                # Only observed entry from outside the circle; no first-point arrivals.
                if distance(prev[1:3],(s['lon'],s['lat']))>70:
                    events.append([t-midnight,nearest,int(((direction+45)%360)//90)])
            if nearest is not None:last_stop=nearest
            elif last_stop is not None:
                s=stops[last_stop]
                if distance((lon,lat),(s['lon'],s['lat']))>110:last_stop=None
            points.append([t-midnight,round(lon*1e6),round(lat*1e6),speed,direction])
            prev=(t,lon,lat,jump)
        tr['points']=points;tr['visits']=events;tracks.append(tr)
    if not tracks:raise ValueError('No GPS points in map for '+date)
    counters['points']=sum(len(t['points']) for t in tracks);counters['vehicles']=len({t['id'] for t in tracks});counters['routes']=len({t['route'] for t in tracks})
    source='https://huggingface.co/datasets/'+REPO+'/blob/main/transport/'+date+'.csv'
    quality=dict(counters);quality['collectionOffsetHours']=offsets.most_common(1)[0][0];quality['rawSHA256']=hashlib.sha256(path.read_bytes()).hexdigest()
    return {'version':1,'date':date,'epoch':midnight,'start':int(start-midnight),'end':int(end-midnight),'bounds':bounds,'quality':quality,'source':source,'tracks':tracks}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--days',type=int,default=7);parser.add_argument('--offline',action='store_true');parser.add_argument('--stops',type=pathlib.Path);args=parser.parse_args()
    raw=ROOT/'raw';out=ROOT/'dist/data/transport';out.mkdir(parents=True,exist_ok=True)
    bounds=json.loads((ROOT/'dist/data/terrain.json').read_text())['bounds']
    stops_path=args.stops or raw/'stops-current.json'
    if not args.offline:download(STOPS_URL,stops_path)
    catalog=json.loads(stops_path.read_text());stops=[]
    for s in catalog:
        lon,lat=float(s['lng'])/1e6,float(s['lat'])/1e6
        if not (-180<=lon<=180 and -90<=lat<=90):raise ValueError('Invalid stop coordinate')
        stops.append({'id':str(s['id']),'name':s['name'].strip() or 'Остановка №'+str(s['id']),'description':s['descr'].strip(),'lon':lon,'lat':lat,'type':str(s['type']),'inMap':bounds[0]<=lon<=bounds[2] and bounds[1]<=lat<=bounds[3]})
    if len({(s['type'],s['id']) for s in stops})!=len(stops):raise ValueError('Duplicate stop IDs')
    updated=dt.datetime.now(MOSCOW).isoformat(timespec='seconds')
    write(out/'stops.json',{'updatedAt':updated,'source':STOPS_URL,'inMap':sum(s['inMap'] for s in stops),'stops':stops})
    if args.offline:dates=sorted(p.stem.removeprefix('transport-') for p in raw.glob('transport-*.csv'))[-args.days:]
    else:
        tree=json.load(urllib.request.urlopen('https://huggingface.co/api/datasets/'+REPO+'/tree/main/transport?limit=1000'))
        dates=sorted(pathlib.Path(x['path']).stem for x in tree if x['path'].endswith('.csv'))[-args.days:]
    days=[]
    for date in dates:
        path=raw/('transport-'+date+'.csv')
        if not path.exists():download(BASE+'transport/'+date+'.csv',path)
        data=prepare_day(date,path,bounds,stops);write(out/(date+'.json'),data)
        summary={k:v for k,v in data.items() if k!='tracks'};summary['file']=date+'.json';days.append(summary)
        print(date,data['quality'],flush=True)
    write(out/'manifest.json',{'version':1,'updatedAt':updated,'dataset':'https://huggingface.co/datasets/'+REPO,'attribution':'daniilakk · buscheb.ru','clock':'Europe/Moscow · GPS lasttime','bounds':bounds,'days':days,'method':{'maxGapSeconds':MAX_GAP,'maxSpeedKmh':MAX_SPEED,'stopRadiusMeters':70,'gridMeters':250,'slowKmh':5}})

if __name__=='__main__':main()
