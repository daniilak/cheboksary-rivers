#!/usr/bin/env python3
"""Independent fixtures for source clock, encoded coordinates and audit rules."""
import csv,datetime as dt,pathlib,tempfile
import analyze_mobility as m
from prepare_transport import distance
assert m.timestamp('09.10.2026 08:00:00')==int(dt.datetime(2026,10,9,5,tzinfo=dt.timezone.utc).timestamp())
raw_lon=47.25*1800000-3962591;raw_lat=56.125*1200000-3193782
assert m.decode(raw_lon,raw_lat)==(47.25,56.125)
assert abs(distance((47.25,56.125),(47.25,56.126))-111.195)<.01
z=m.stats([10,30]);assert z['median']==20 and z['p90']==28 and z['cv']==.5 and z['wait']==12.5
assert m.cluster_ci([[10]]*4,lambda x:sum(x)/len(x)) is None
assert m.cluster_ci([[10]]*5,lambda x:sum(x)/len(x))==[10,10]
assert m.crossed_speed_ci([(str(d),str(v),60,100) for d in range(6) for v in range(7)])==[6,6]
assert m.crossed_speed_ci([('one','one',60,100)]) is None
old_raw=m.RAW
with tempfile.TemporaryDirectory() as tmp:
    m.RAW=pathlib.Path(tmp);date='2026-10-09';p=m.RAW/('transport-'+date+'.csv')
    fields=['created_at','id_api','rid','lon','lat','lasttime','speed','rtype','rnum','big_jump']
    base=dict(created_at=m.timestamp('09.10.2026 08:00:00')+10800,id_api='one',rid='1',lon=raw_lon,lat=raw_lat,lasttime='09.10.2026 08:00:00',speed='1',rtype='Т',rnum='1',big_jump='0')
    rows=[base,dict(base,created_at=base['created_at']+1,lon=raw_lon+180),dict(base,lasttime='08.10.2026 08:00:00'),dict(base,id_api='two',lon='bad'),dict(base,id_api='three',lon=0,lat=0)]
    with p.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,delimiter='\t');w.writeheader();w.writerows(rows)
    tracks,a=m.read_day(date)
    assert a['counts']=={'rawRows':5,'duplicates':1,'duplicateCoordinateConflicts':1,'outsideFileDate':1,'invalidRows':1,'outsideMap':1}
    assert len(tracks)==1 and next(iter(tracks.values()))[0][1]==47.2501
    assert a['speedValues']==[('1',5)]
m.RAW=old_raw
print('PASS: Moscow clock, encoded coordinate calibration, geodesic distance, interval/wait formula, day bootstrap and actual TSV duplicate/date/invalid/outside audit.')
