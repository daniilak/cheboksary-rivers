#!/usr/bin/env python3
"""Extract explicit walk links, road attributes, barriers and demand proxies.
Requires osmium. Never infer a sidewalk from a motor road centreline.
"""
import hashlib, json, pathlib, sys
import osmium

ROOT = pathlib.Path(__file__).resolve().parents[1]
B = json.loads((ROOT/'dist/data/terrain.json').read_text())['bounds']
OUT = ROOT/'raw/mobility-osm.json'
KEEP = ['name','name:ru','highway','foot','access','wheelchair','surface','smoothness',
        'incline','lit','width','kerb','crossing','crossing:signals','barrier','lanes',
        'maxspeed','oneway','bridge','tunnel','layer','sidewalk','building','building:levels',
        'amenity','shop','office','industrial','public_transport','addr:street','addr:housenumber']
WALK = {'footway','pedestrian','path','steps','living_street','cycleway','service','track'}
POI = {'school','kindergarten','university','college','hospital','clinic','doctors',
       'marketplace','bus_station','social_facility'}
RES = {'apartments','residential','house','detached','dormitory','terrace'}
def inside(x,y): return B[0]<=x<=B[2] and B[1]<=y<=B[3]
def tags(o): return {k:o.tags[k] for k in KEEP if k in o.tags}
nodes={}; ways=[]; roads=[]; pois=[]; barriers=[]
class Extract(osmium.SimpleHandler):
    def node(self,n):
        if not n.location.valid(): return
        x,y=n.location.lon,n.location.lat
        if not inside(x,y): return
        t=tags(n)
        if n.tags.get('highway')=='crossing' or 'barrier' in n.tags or any(k in n.tags for k in ['kerb','wheelchair']):
            nodes[n.id]=[x,y,t]
        if 'barrier' in n.tags: barriers.append({'id':n.id,'point':[x,y],'tags':t,'type':'node'})
        if n.tags.get('amenity') in POI or 'shop' in n.tags or 'office' in n.tags:
            pois.append({'id':n.id,'type':'node','point':[x,y],'tags':t})
    def way(self,w):
        t=tags(w); h=t.get('highway'); building=t.get('building')
        relevant=h or 'barrier' in t or building in RES or t.get('amenity') in POI or 'shop' in t or 'office' in t or 'industrial' in t
        if not relevant:return
        try: pts=[[n.lon,n.lat] for n in w.nodes]; ids=[n.ref for n in w.nodes]
        except osmium.InvalidLocationError:return
        if not pts or not any(inside(*p) for p in pts):return
        if h:
            pedestrian=h in WALK and t.get('foot') not in ['no','private'] and t.get('access') not in ['no','private']
            if h=='cycleway' and t.get('foot') not in ['yes','designated','permissive']:pedestrian=False
            if h=='path' and t.get('foot')=='no':pedestrian=False
            if pedestrian:
                ways.append({'id':w.id,'nodes':ids,'tags':t})
                for i,p in zip(ids,pts):nodes.setdefault(i,[*p,{}])
            elif h not in ['construction','proposed','bus_stop']:
                roads.append({'id':w.id,'points':pts,'tags':t})
        if 'barrier' in t:barriers.append({'id':w.id,'points':pts,'tags':t,'type':'way'})
        if building in RES or t.get('amenity') in POI or 'shop' in t or 'office' in t or 'industrial' in t:
            p=pts[:-1] if pts[0]==pts[-1] else pts
            pois.append({'id':w.id,'type':'way','point':[sum(x[0] for x in p)/len(p),sum(x[1] for x in p)/len(p)],'tags':t})

if __name__=='__main__':
    p=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'raw/RU-CU-2026-10-02.pbf'
    Extract().apply_file(str(p),locations=True)
    data={'bounds':B,'snapshot':'2026-10-02T14:52:36Z','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
          'nodes':nodes,'ways':ways,'roads':roads,'pois':pois,'barriers':barriers}
    OUT.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
    print({k:len(data[k]) for k in ['nodes','ways','roads','pois','barriers']})
