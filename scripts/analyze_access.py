#!/usr/bin/env python3
"""Explicit OSM pedestrian graph. No straight-radius accessibility claims.
Snap to edges, <=30 m, rejecting connectors across motor axes or barriers.
Disconnected OSM is missing evidence, never proof of a missing real sidewalk.
"""
import json, math, pathlib, heapq
from collections import defaultdict,Counter
from analyze_mobility import ROOT,RAW,OUT,BOUNDS,STOPS,MX,xy,write,export_csv
from prepare_transport import distance

def intersects(a,b,c,d):
    def cross(p,q,r):return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    # Interior intersections; an endpoint exactly on road axis does not create a crossing.
    return cross(a,b,c)*cross(a,b,d)<-1e-8 and cross(c,d,a)*cross(c,d,b)<-1e-8
def projection(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];u=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))) if dx or dy else 0
    q=(a[0]+u*dx,a[1]+u*dy);return math.dist(p,q),u,q
def gridcells(a,b,size=50):
    for x in range(math.floor(min(a[0],b[0])/size),math.floor(max(a[0],b[0])/size)+1):
        for y in range(math.floor(min(a[1],b[1])/size),math.floor(max(a[1],b[1])/size)+1):yield x,y
def main():
    osm=json.loads((RAW/'mobility-osm.json').read_text());ids=list(osm['nodes']);idmap={v:i for i,v in enumerate(ids)}
    nodes=[[round(osm['nodes'][i][0],7),round(osm['nodes'][i][1],7)] for i in ids];pos=[xy(p) for p in nodes]
    edges=[];adj=[[] for _ in nodes];edgeindex=defaultdict(list);blockindex=defaultdict(list);roadindex=defaultdict(list)
    flags=Counter();seen=set()
    for w in osm['ways']:
        t=w['tags'];base=0
        if t.get('highway')=='steps':base|=1
        if t.get('wheelchair')=='no':base|=2
        if t.get('surface') in ['sand','mud','ground','cobblestone','unpaved','gravel']:base|=4
        if t.get('highway') in ['service','track','living_street']:base|=8
        if 'wheelchair' not in t:base|=16
        if 'lit' not in t:base|=32
        try:
            if abs(float(t.get('incline','').rstrip('%')))>5:base|=64
        except ValueError:pass
        for a,b in zip(w['nodes'],w['nodes'][1:]):
            if str(a) not in idmap or str(b) not in idmap:continue
            a,b=idmap[str(a)],idmap[str(b)];f=base
            for k in [a,b]:
                nt=osm['nodes'][ids[k]][2]
                if nt.get('access') in ['no','private'] or nt.get('foot')=='no' or nt.get('barrier') in ['fence','wall','retaining_wall']:f|=128
                if nt.get('wheelchair')=='no' or nt.get('kerb') in ['raised']:f|=2
                if nt.get('barrier') and nt.get('barrier') not in ['fence','wall','retaining_wall'] and nt.get('wheelchair')!='yes':f|=256
            if a==b or (min(a,b),max(a,b),f) in seen:continue
            seen.add((min(a,b),max(a,b),f));length=round(math.dist(pos[a],pos[b]),2)
            if length<=0:continue
            ei=len(edges);edges.append([a,b,length,f,w['id']]);flags[f]+=1
            if not f&128:adj[a].append((b,length,ei));adj[b].append((a,length,ei))
            for c in gridcells(pos[a],pos[b]):edgeindex[c].append(ei)
    for r in osm['roads']:
        pts=[xy(p) for p in r['points']]
        for a,b in zip(pts,pts[1:]):
            for c in gridcells(a,b):
                blockindex[c].append((a,b));roadindex[c].append((a,b,r))
    for bar in osm['barriers']:
        if bar['type']!='way' or bar['tags'].get('barrier') not in ['fence','wall','retaining_wall','hedge']:continue
        pts=[xy(p) for p in bar['points']]
        for a,b in zip(pts,pts[1:]):
            for c in gridcells(a,b):blockindex[c].append((a,b))
    # Short snap connectors cannot invent a crossing of mapped open water.
    water=json.loads((ROOT/'dist/data/water.json').read_text())
    for feature in water:
        geometry=feature['geometry'];polys=[geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
        for poly in polys:
            for ring in poly:
                pts=[xy(p) for p in ring]
                for a,b in zip(pts,pts[1:]):
                    for c in gridcells(a,b):blockindex[c].append((a,b))
    rivers=json.loads((ROOT/'dist/data/rivers.json').read_text())
    for river in rivers:
        for i,segment in enumerate(river['segments']):
            attrs=river.get('segmentAttributes',[{}]*len(river['segments']))[i]
            if attrs.get('tunnel') not in [None,'no'] or attrs.get('covered')=='yes':continue
            pts=[xy(p) for p in segment]
            for a,b in zip(pts,pts[1:]):
                for c in gridcells(a,b):blockindex[c].append((a,b))
    def snap(p):
        p=xy(p);cx,cy=math.floor(p[0]/50),math.floor(p[1]/50);best=None
        for ei in {v for x in range(cx-1,cx+2) for y in range(cy-1,cy+2) for v in edgeindex[(x,y)]}:
            a,b,l,f,_=edges[ei]
            if f&128:continue
            d,u,q=projection(p,pos[a],pos[b])
            if d>30 or best and d>=best['offset']:continue
            if any(intersects(p,q,c,d) for cell in gridcells(p,q) for c,d in blockindex[cell]):continue
            best={'edge':ei,'offset':round(d,2),'u':round(u,6),'seeds':[[a,round(d+u*l,2)],[b,round(d+(1-u)*l,2)]]}
        return best
    def dijkstra(seeds,limit=math.inf,accessible=False):
        dist={};heap=[]
        for node,cost in seeds:
            if cost<dist.get(node,math.inf):dist[node]=cost;heapq.heappush(heap,(cost,node))
        while heap:
            cost,node=heapq.heappop(heap)
            if cost!=dist[node]:continue
            for nxt,length,ei in adj[node]:
                if accessible and edges[ei][3]&(1|2|4|64|256):continue
                v=cost+length
                if v<=limit and v<dist.get(nxt,math.inf):dist[nxt]=v;heapq.heappush(heap,(v,nxt))
        return dist
    stop_snaps=[snap([s['lon'],s['lat']]) if s['inMap'] and s['type']=='0' else None for s in STOPS]
    edge_stops=defaultdict(list)
    for ss in stop_snaps:
        if ss:edge_stops[ss['edge']].append(ss)
    seeds=[v for ss in stop_snaps if ss for v in ss['seeds']]
    dist=dijkstra(seeds);wheel_seeds=[v for ss in stop_snaps if ss and not edges[ss['edge']][3]&(1|2|4|64|256) for v in ss['seeds']]
    wd=dijkstra(wheel_seeds,accessible=True)
    def cost(ss,dist):
        if not ss:return None
        a,b,l,f,_=edges[ss['edge']];v=ss['offset']+min(dist.get(a,math.inf)+ss['u']*l,dist.get(b,math.inf)+(1-ss['u'])*l)
        return round(v,1) if math.isfinite(v) else None
    pois=[]
    for p in osm['pois']:
        ss=snap(p['point']);v=cost(ss,dist);wv=cost(ss,wd)
        if ss:
            same=edge_stops.get(ss['edge'],[])
            if same:
                direct=min(ss['offset']+st['offset']+abs(ss['u']-st['u'])*edges[ss['edge']][2] for st in same)
                v=round(min(v if v is not None else math.inf,direct),1)
                if not edges[ss['edge']][3]&(1|2|4|64|256):wv=round(min(wv if wv is not None else math.inf,direct),1)
        if ss and edges[ss['edge']][3]&(1|2|4|64|256):wv=None
        tags=p['tags'];res=tags.get('building') in ['apartments','residential','house','detached','dormitory','terrace']
        cat='жильё' if res else 'образование' if tags.get('amenity') in ['school','kindergarten','university','college'] else 'медицина' if tags.get('amenity') in ['hospital','clinic','doctors','social_facility'] else 'работа' if 'office' in tags or 'industrial' in tags else 'торговля и пересадки'
        name=tags.get('name:ru',tags.get('name')) or ' '.join(filter(None,[tags.get('addr:street'),tags.get('addr:housenumber')])) or ('Жилое здание' if res else tags.get('amenity',tags.get('shop','Объект')))
        straight=min(distance(p['point'],(s['lon'],s['lat'])) for s in STOPS if s['inMap'] and s['type']=='0')
        pois.append({'id':str(p['id']),'osmType':p['type'],'name':name,'category':cat,'point':p['point'],'distance':v,'accessibleDistance':wv,
          'straightDistance':round(straight,1),'snap':ss,'detourRatio':round(v/straight,2) if v and straight>30 else None,'tags':tags})
    # Known shared crossings keep connectivity by common OSM node, without geometric joins.
    crossings=[{'id':i,'point':nodes[idmap[i]],'tags':v[2]} for i,v in osm['nodes'].items() if v[2].get('highway')=='crossing']
    stops=[]
    for i,s in enumerate(STOPS):
        if not s['inMap'] or s['type']!='0':continue
        p=xy([s['lon'],s['lat']]);cx,cy=math.floor(p[0]/50),math.floor(p[1]/50);road=None;rd=math.inf
        for x in range(cx-2,cx+3):
            for y in range(cy-2,cy+3):
                for a,b,r in roadindex[(x,y)]:
                    d,_,_=projection(p,a,b)
                    if d<rd:rd=d;road=r
        same=[j for j,ss in enumerate(STOPS) if j!=i and ss['inMap'] and ss['type']=='0' and ss['name']==s['name'] and 30<distance((s['lon'],s['lat']),(ss['lon'],ss['lat']))<700]
        partners=sorted(same,key=lambda j:distance((s['lon'],s['lat']),(STOPS[j]['lon'],STOPS[j]['lat'])))[:1]
        transfer=None
        if partners and stop_snaps[i]:
            j=partners[0];ss=stop_snaps[j]
            v=cost(ss,dijkstra(stop_snaps[i]['seeds'],limit=2500))
            # direct movement within the same edge also matters
            if ss and ss['edge']==stop_snaps[i]['edge']:
                direct=ss['offset']+stop_snaps[i]['offset']+abs(ss['u']-stop_snaps[i]['u'])*edges[ss['edge']][2]
                v=round(min(v if v is not None else math.inf,direct),1)
            straight=distance((s['lon'],s['lat']),(STOPS[j]['lon'],STOPS[j]['lat']))
            transfer={'to':j,'distance':v,'straightDistance':round(straight,1),'detourRatio':round(v/straight,2) if v is not None else None}
        nearby=[p for p in pois if distance(p['point'],(s['lon'],s['lat']))<=400]
        nearest_cross=min(crossings,key=lambda c:distance(c['point'],(s['lon'],s['lat']))) if crossings else None
        stops.append({'stop':i,'snap':stop_snaps[i],'partner':transfer,'potentialObjects':dict(Counter(p['category'] for p in nearby)),
          'road':{'id':str(road['id']),'tags':road['tags'],'distance':round(rd,1)} if road else None,
          'crossing':{'id':nearest_cross['id'],'distance':round(distance(nearest_cross['point'],(s['lon'],s['lat'])),1),'point':nearest_cross['point'],'tags':nearest_cross['tags']} if nearest_cross else None})
    # Source graph lazy-loaded in worker; no additional HTTP calls or full raw OSM in browser.
    write(OUT/'walk-graph.json',{'version':1,'bounds':BOUNDS,'nodes':nodes,'edges':edges,'stops':stop_snaps,
      'flags':{'1':'steps','2':'explicit wheelchair/kerb barrier','4':'rough surface','8':'shared service/living road','16':'wheelchair unknown','32':'lighting unknown','64':'incline >5%','128':'access blocked','256':'gate accessibility unknown'}})
    write(OUT/'walk-objects.json',[{'name':p['name'],'category':p['category'],'point':p['point'],'snap':p['snap']} for p in pois])
    write(OUT/'access.json',{'version':1,'snapshot':osm['snapshot'],'sha256':osm['sha256'],'stops':stops,'pois':pois,'crossings':crossings,
      'summary':{'nodes':len(nodes),'edges':len(edges),'stops':len(stops),'snappedStops':sum(s['snap'] is not None for s in stops),
      'objects':len(pois),'connectedObjects':sum(p['distance'] is not None for p in pois),'categories':dict(Counter(p['category'] for p in pois))},
      'method':{'snapMaxMeters':30,'walkSpeedKmh':4.5,'timeMinutes':10,'distanceBudgetMeters':750,'accessibleSpeedKmh':3,
      'limits':['OSM explicit footway/path/pedestrian/steps, foot-permitted cycleway, service/living street/track; road-centreline sidewalks never invented.',
      'Connectors <=30 m, rejected if intersecting motor road axes or barrier lines. Connectors and building centroids are assumptions, not verified entrances.',
      'Network uses common OSM node IDs only. Geometric crossings are not automatically connected; relations/multipolygon POIs and unrecorded paths are not covered.',
      'No-network result means incomplete or disconnected mapping, not physical inaccessibility. Water crossings only use mapped connected ways; no shortcuts are added.',
      'Limited mobility mode removes mapped steps, wheelchair=no, raised kerbs, rough surfaces, incline >5%, gates without wheelchair=yes. Unknown kerbs, slopes and surfaces remain unknown, not certified accessible.',
      'School/clinic/shop/workplace and residential buildings are potential demand proxies; each object counts once, no inhabitants or jobs allocated. No passenger load estimates.',
      'Same-name stop pair is a transfer/opposite-direction hypothesis. Direction and entrances must be verified on site. Nearest crossing straight distance is not walking distance.']}})
    export_csv('access',[{k:v for k,v in p.items() if k!='snap'} for p in pois]);print('Access',len(nodes),len(edges),sum(s is not None for s in stop_snaps),'snapped stops',sum(p['distance'] is not None for p in pois),'connected objects',flush=True)

if __name__=='__main__':main()
