import osmium,json,sys
from shapely.geometry import shape, mapping, box
bbox=box(47.08,56.04,47.44,56.17)
features=[]; waters=[]
factory=osmium.geom.GeoJSONFactory()
class Extract(osmium.SimpleHandler):
    def way(self,w):
        if w.tags.get('waterway') not in ['river','stream','canal']:return
        try:
            g=shape(json.loads(factory.create_linestring(w)))
            if not g.intersects(bbox):return
            features.append({'type':'way','id':w.id,'tags':dict(w.tags),'geometry':[{'lon':x,'lat':y} for x,y in g.coords]})
        except Exception:pass
    def area(self,a):
        if a.tags.get('natural')!='water':return
        try:
            g=shape(json.loads(factory.create_multipolygon(a)))
            if not g.intersects(bbox):return
            for p in g.geoms:
                if not p.intersects(bbox):continue
                members=[{'role':'outer','geometry':[{'lon':x,'lat':y} for x,y in p.exterior.coords]}]
                members.extend({'role':'inner','geometry':[{'lon':x,'lat':y} for x,y in r.coords]} for r in p.interiors)
                features.append({'type':'relation','id':a.id,'tags':dict(a.tags),'members':members})
        except Exception:pass
Extract().apply_file(sys.argv[1],locations=True)
json.dump({'elements':features},open(sys.argv[2],'w'),ensure_ascii=False)
print('Extracted features:',len(features))
