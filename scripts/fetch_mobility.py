#!/usr/bin/env python3
"""Fetch the audited date window, preserving existing raw files for reproducibility."""
import concurrent.futures,json,pathlib,re,urllib.request
from analyze_mobility import RAW,DATES
API='https://huggingface.co/api/datasets/daniilakk/cheboksary-public-transport-gps-daily/tree/main/transport?limit=1000'
BASE='https://huggingface.co/datasets/daniilakk/cheboksary-public-transport-gps-daily/resolve/main/transport/'
def main():
    tree=[];url=API
    while url:
        with urllib.request.urlopen(url,timeout=90) as r:
            tree.extend(json.load(r));link=r.headers.get('Link','');match=re.search(r'<([^>]+)>;\s*rel="next"',link);url=match[1] if match else None
    (RAW/'archive-tree.json').write_text(json.dumps(tree))
    files={pathlib.Path(v['path']).stem:v for v in tree if v['path'].endswith('.csv')}
    def get(date):
        if date not in files:return date,'нет файла в источнике'
        p=RAW/('transport-'+date+'.csv')
        if not p.exists():
            partial=p.with_suffix('.csv.part');urllib.request.urlretrieve(BASE+date+'.csv',partial);partial.rename(p)
        if p.stat().st_size!=files[date]['size']:raise ValueError('Source size changed: '+date+'; preserve/review raw file before replacing')
        return date,p.stat().st_size
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for date,size in ex.map(get,DATES):print(date,size,flush=True)
if __name__=='__main__':main()
