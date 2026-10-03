"""Build real OSM buildings, connected-water seeds and Volga cross sections.
Usage: python scripts/prepare_hydrology.py REGION.pbf
Requires osmium, numpy, shapely, rasterio (same environment as prepare_data.py).
"""
import hashlib, json, math, sys
from pathlib import Path
import numpy as np
import osmium
import rasterio
from rasterio.features import rasterize
from shapely.geometry import shape, mapping, box, LineString, Point
from shapely.ops import transform, unary_union, linemerge
from shapely import contains_xy

root = Path(__file__).resolve().parents[1]
out = root / 'dist/data'
meta = json.loads((out/'terrain.json').read_text())
boundary = shape(json.loads((out/'boundary.json').read_text()))
w, s, e, n = meta['bounds']; nx, ny = meta['width'], meta['height']
mx = 111320 * math.cos(math.radians((s+n)/2)); my = 111320
project = lambda x,y,z=None: ((x-w)*mx, (y-s)*my)
unproject = lambda x,y,z=None: (x/mx+w, y/my+s)
extent = box(w,s,e,n)
factory = osmium.geom.GeoJSONFactory()
records = []; full_water = []; river_tags = {}; segment_tags = {}; warnings = []

def number(value):
    try:
        value = float(str(value).replace(' m','').replace(',','.'))
        return value if math.isfinite(value) and value > 0 else None
    except (ValueError,TypeError): return None

class Extract(osmium.SimpleHandler):
    def way(self, way):
        if way.tags.get('waterway') in ('river','stream','canal'):
            river_tags[way.id] = {k:v for k,v in way.tags if k in ('tunnel','covered','layer','intermittent','width','waterway','name','name:ru')}
            try:
                geom=shape(json.loads(factory.create_linestring(way)))
                limit=box(boundary.bounds[0],boundary.bounds[1],boundary.bounds[2],n) if way.tags.get('name:ru',way.tags.get('name'))=='Волга' else boundary
                clipped=geom.intersection(limit)
                def lineparts(g):
                    if g.is_empty:return []
                    if g.geom_type=='LineString':return [g]
                    return [p for child in getattr(g,'geoms',[]) for p in lineparts(child)]
                segment_tags[way.id]=[river_tags[way.id] for p in lineparts(clipped) if p.length>=.00001]
            except Exception: pass
    def area(self, area):
        tags = dict(area.tags)
        building = tags.get('building') not in (None, 'no')
        volga = tags.get('natural') == 'water' and tags.get('name:ru', tags.get('name')) in ('Волга','Чебоксарское водохранилище')
        if not (building or volga): return
        try:
            geom = shape(json.loads(factory.create_multipolygon(area)))
            if not geom.is_valid: geom = geom.buffer(0)
            if not geom.intersects(extent): return
            if volga: full_water.append(geom)
            if not building or not geom.intersects(boundary): return
            # Preserve full footprints of buildings intersecting the city, including courtyards.
            h = number(tags.get('height')); levels = number(tags.get('building:levels'))
            source = 'height' if h else 'building:levels × 3 m' if levels else 'assumed 6 m'
            h = h or (levels*3 if levels else 6)
            parts = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
            oid = ('way/' if area.from_way() else 'relation/') + str(area.orig_id())
            for part in parts:
                if not part.intersects(boundary): continue
                records.append({'osm':oid,'kind':tags['building'],'height':round(min(h,300),1),'heightSource':source,
                    'name':tags.get('name',''),'address':' '.join(filter(None,[tags.get('addr:street'),tags.get('addr:housenumber')])),
                    'geometry':mapping(part)})
        except Exception as ex: warnings.append(str(ex))

Extract().apply_file(sys.argv[1],locations=True)
records.sort(key=lambda v:(v['osm'],str(v['geometry']['coordinates'][0][0])))
with rasterio.open(out/'cheboksary-glo30.tif') as src:
    heights = src.read(1); tf = src.transform
    # Resolve only footprints containing a grid centre; do not invent walls across narrow streets.
    building_mask = rasterize([(shape(v['geometry']),1) for v in records],out_shape=(ny,nx),transform=tf,fill=0,dtype='uint8')
    for rec in records:
        poly = shape(rec['geometry']); metric = transform(project,poly)
        # Sample exterior at <=10 m spacing to assess contact, including sub-grid footprints.
        exterior = metric.exterior
        points = [transform(unproject,exterior.interpolate(d)) for d in np.linspace(0,exterior.length,max(5,math.ceil(exterior.length/10)))]
        cells = set()
        for p in points:
            col,row = ~tf * (p.x,p.y); col,row=int(col),int(row)
            if 0<=col<nx and 0<=row<ny: cells.add(row*nx+col)
        # Include adjacent open cells so impermeable building cells can still be exposed.
        contacts=set(cells)
        for k in cells:
            row,col=divmod(k,nx)
            for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
                if 0<=row+dy<ny and 0<=col+dx<nx: contacts.add((row+dy)*nx+col+dx)
        rec['contactCells']=sorted(k for k in contacts if not building_mask.flat[k])
        rec['baseElevation']=round(float(np.percentile([heights.flat[k] for k in contacts],20)),2) if contacts else meta['min']
        rec['area']=round(metric.area,1)
        bx0,by0,bx1,by1=poly.bounds
        c0,r0=~tf*(bx0,by1); c1,r1=~tf*(bx1,by0)
        cols=np.arange(max(0,math.floor(c0)),min(nx,math.ceil(c1)))
        rows=np.arange(max(0,math.floor(r0)),min(ny,math.ceil(r1)))
        cc,rr=np.meshgrid(cols+.5,rows+.5)
        gx=tf.a*cc+tf.c; gy=tf.e*rr+tf.f
        rec['resolved']=bool(contains_xy(poly,gx,gy).any())
    building_mask.tofile(out/'building-mask.bin')

water = unary_union(full_water)
yy,xx=np.meshgrid(np.linspace(n,s,ny),np.linspace(w,e,nx),indexing='ij')
seed=contains_xy(water,xx,yy).astype('uint8'); seed.tofile(out/'volga-mask.bin')
# Consistent display datum in EGM2008 from DSM water pixels, not a Baltic-system gauge elevation.
values=heights[seed.astype(bool)]
baseline=float(np.median(values))

rivers=json.loads((out/'rivers.json').read_text())
for river in rivers:
    river['osm_attributes']=[{'id':oid,**river_tags.get(oid,{})} for oid in river['osm_ids']]
    river['segmentAttributes']=[tags for oid in river['osm_ids'] for tags in segment_tags.get(oid,[])]
    if len(river['segmentAttributes']) != len(river['segments']): raise ValueError('Segment metadata misalignment: '+river['name'])
json.dump(rivers,open(out/'rivers.json','w'),ensure_ascii=False,separators=(',',':'))
volga=next(r for r in rivers if r['name']=='Волга')
merged=linemerge([LineString(seg) for seg in volga['segments']])
if merged.geom_type!='LineString': raise ValueError('Volga centreline must form one connected reach')
coords=list(merged.coords)
if coords[0][0]>coords[-1][0]: coords.reverse()
axis=transform(project,LineString(coords)); metric_water=transform(project,water)
sections=[]
for chain in np.linspace(100,axis.length-100,max(3,math.ceil(axis.length/250))):
    p=axis.interpolate(chain); a=axis.interpolate(max(0,chain-100)); b=axis.interpolate(min(axis.length,chain+100))
    dx,dy=b.x-a.x,b.y-a.y; length=math.hypot(dx,dy); tx,ty=dx/length,dy/length
    cross=LineString([(p.x-ty*12000,p.y+tx*12000),(p.x+ty*12000,p.y-tx*12000)])
    clipped=cross.intersection(metric_water)
    parts=[clipped] if clipped.geom_type=='LineString' else [g for g in getattr(clipped,'geoms',[]) if g.geom_type=='LineString']
    touching=[g for g in parts if g.distance(p)<1]
    if not touching: continue
    cut=max(touching,key=lambda g:g.length)
    ends=list(cut.coords); left,right=ends[0],ends[-1]
    sections.append({'chainage':round(float(chain),2),'center':list(unproject(p.x,p.y)),
                     'left':list(unproject(*left)),'right':list(unproject(*right)),
                     'width':round(cut.length,2),'tangent':[tx,ty]})

manifest={'baseline':round(baseline,3),'verticalDatum':'EGM2008 (Copernicus DSM), not a gauging-station datum',
    'baselineSource':'median of DSM cells inside OSM Volga polygons','waterElevationP10P90':[float(np.percentile(values,10)),float(np.percentile(values,90))],
    'buildingCount':len(records),'resolvedBuildingCount':sum(v['resolved'] for v in records),
    'heightSources':{key:sum(v['heightSource']==key for v in records) for key in sorted(set(v['heightSource'] for v in records))},
    'osmPbfSha256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'osmSnapshot':'2026-10-02 (provider timestamp; original project download)',
    'sections':sections,'centerline':coords,'warnings':warnings}
json.dump(records,open(out/'buildings.json','w'),ensure_ascii=False,separators=(',',':'))
json.dump(manifest,open(out/'hydrology.json','w'),ensure_ascii=False,separators=(',',':'))
print(json.dumps({k:v for k,v in manifest.items() if k not in ('sections','centerline')},ensure_ascii=False,indent=2))
print('Cross sections:',len(sections),'width range',min(v['width'] for v in sections),max(v['width'] for v in sections))
