"""Rebuild browser assets from Copernicus GLO-30 and OSM downloads.
Usage: python prepare_data.py DEM.tif boundary.json overpass.json
Requires numpy, rasterio, shapely. Source acquisition documented in SOURCES.md.
"""
import json, sys, math, hashlib
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from shapely.geometry import shape, mapping, LineString, Polygon, box
from shapely.ops import transform, polygonize, unary_union
out=Path(__file__).resolve().parents[1]/'dist/data'
boundary=shape(json.load(open(sys.argv[2]))[0]['geojson'])
west,south,east,north=boundary.bounds
bounds=[west-.006,south-.004,east+.006,max(north+.004,56.205)]
volga_extent=box(west,south,east,bounds[3])
with rasterio.open(sys.argv[1]) as src:
    window=from_bounds(*bounds,src.transform).round_offsets().round_lengths()
    dem=src.read(1,window=window)
    tf=src.window_transform(window)
    h,w=dem.shape
    # Bounds describe sample centres, not outer pixel edges.
    x0,y0=tf*(.5,.5); x1,y1=tf*(w-.5,h-.5)
    dem.astype('<f4').tofile(out/'terrain.bin')
    meta={'width':w,'height':h,'bounds':[x0,y1,x1,y0],'min':float(dem.min()),'max':float(dem.max()),'source':'Copernicus DEM GLO-30, 2021 release','sourcePixelDegrees':[src.res[0],src.res[1]],'sha256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'accessed':'2026-10-03'}
    json.dump(meta,open(out/'terrain.json','w'))
    with rasterio.open(out/'cheboksary-glo30.tif','w',driver='GTiff',height=h,width=w,count=1,dtype=dem.dtype,crs=src.crs,transform=tf,compress='deflate') as dst: dst.write(dem,1)
json.dump(mapping(boundary),open(out/'boundary.json','w'))
data=json.load(open(sys.argv[3])); rivers={}; waters=[]
def lines(g):
    if g.is_empty:return []
    if g.geom_type=='LineString':return [g]
    if hasattr(g,'geoms'):return [v for p in g.geoms for v in lines(p)]
    return []
def polys(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    if hasattr(g,'geoms'):return [v for p in g.geoms for v in polys(p)]
    return []
project=lambda x,y,z=None: (x*111320*math.cos(math.radians(56.1)),y*111320)
for e in data['elements']:
    t=e.get('tags',{})
    if e['type']=='way' and t.get('waterway') in ['river','stream','canal']:
        coords=[(p['lon'],p['lat']) for p in e.get('geometry',[]) if 'lon' in p]
        if len(coords)<2:continue
        is_volga=t.get('name:ru',t.get('name'))=='Волга'
        parts=lines(LineString(coords).intersection(volga_extent if is_volga else boundary))
        if not parts:continue
        name=t.get('name:ru',t.get('name','Безымянные ручьи'))
        r=rivers.setdefault(name,{'name':name,'segments':[],'length':0,'osm_ids':[],'types':[]})
        r['osm_ids'].append(e['id']); r['types'].append(t['waterway'])
        for p in parts:
            if p.length<.00001:continue
            r['segments'].append([[round(x,7),round(y,7)] for x,y in p.coords]);r['length']+=transform(project,p).length
    elif t.get('natural')=='water':
        try:
            if e['type']=='way':
                c=[(p['lon'],p['lat']) for p in e.get('geometry',[]) if 'lon' in p]
                if len(c)<4 or c[0]!=c[-1]:continue
                g=Polygon(c)
            else:
                outer=[];inner=[]
                for m in e.get('members',[]):
                    c=[(p['lon'],p['lat']) for p in m.get('geometry',[]) if 'lon' in p]
                    if len(c)>1:(inner if m.get('role')=='inner' else outer).append(LineString(c))
                g=unary_union(list(polygonize(unary_union(outer))))
                if inner:g=g.difference(unary_union(list(polygonize(unary_union(inner)))))
            if not g.is_valid:g=g.buffer(0)
            is_volga=t.get('name:ru',t.get('name')) in ['Волга','Чебоксарское водохранилище']
            for p in polys(g.intersection(volga_extent if is_volga else boundary)):
                if p.area>1e-8:waters.append({'name':t.get('name','Водоём'),'geometry':mapping(p)})
        except Exception as ex: print('water warning',e['id'],ex)
for r in rivers.values():
    r['length']=round(r['length']);r['types']=list(set(r['types']))
json.dump(sorted(rivers.values(),key=lambda r:(r['name']!='Волга',r['name']=='Безымянные ручьи',-r['length'])),open(out/'rivers.json','w'),ensure_ascii=False,separators=(',',':'))
json.dump(waters,open(out/'water.json','w'),ensure_ascii=False,separators=(',',':'))
print(meta)
print([(r['name'],r['length'],len(r['segments'])) for r in rivers.values()]);print('water polygons',len(waters))

# Aligned classification mask: 0 context, 1 city land, 2 water.
from shapely import contains_xy
yy,xx=np.meshgrid(np.linspace(y0,y1,h),np.linspace(x0,x1,w),indexing='ij')
mask=contains_xy(boundary,xx,yy).astype('uint8')
water_union=unary_union([shape(v['geometry']) for v in waters])
mask[contains_xy(water_union,xx,yy)]=2
mask.tofile(out/'surface-mask.bin')
