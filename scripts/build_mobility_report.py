#!/usr/bin/env python3
"""Produce a small browser report, reviewable cards, exports and static report."""
import html,json,math,statistics
from collections import Counter,defaultdict
from analyze_mobility import ROOT,RAW,OUT,STOPS,BOUNDS,WEIGHTS,DATES,PERIODS,write,export_csv,center
from prepare_transport import distance

SOURCES=[
 {'id':'gps','name':'GPS-архив daniilakk / buscheb.ru','url':'https://huggingface.co/datasets/daniilakk/cheboksary-public-transport-gps-daily','date':'файлы 14.09–07.10.2026; проверено 09.10.2026','use':'Движение наблюдаемых машин; аудит 24 файлов, SHA-256 в audit.json.','limit':'CC BY 4.0 по карточке. Не все машины наблюдаются; speed=1 не используется; lasttime принят как МСК по публичному клиенту.'},
 {'id':'stops','name':'Каталог остановок buscheb.ru','url':'https://buscheb.ru/php/getStations.php?city=cheboksari','date':'09.10.2026 02:12 МСК','use':'722 остановки/причала, 556 наземных внутри рельефа.','limit':'Нынешний каталог применён к сентябрьскому GPS; исторические переносы, точность стороны посадки и состояние площадок не проверены.'},
 {'id':'osm','name':'OpenStreetMap · снимок Чувашии','url':'https://www.osmlab.ru/regions/RU-CU.pbf','date':'снимок поставщика 02.10.2026 14:52:36 UTC; расчёт 09.10.2026','use':'Пешеходные пути, переходы, дорожные теги, ограждения и объекты притяжения.','limit':'© OpenStreetMap contributors, ODbL. Неполнота тегов и связности не означает отсутствия объекта. Информация о входах и МГН часто отсутствует; отношения POI не извлекаются.'},
 {'id':'routes','name':'ЧТУ · официальные маршруты','url':'https://xn--21-qmces.xn--p1ai/marshruty.html','date':'проверено 09.10.2026; дата обновления страницы не указана','use':'Контекст названий остановок и последовательностей, например троллейбуса №1.','limit':'GPS не привязан к официальной оси маршрута. Страница не подтверждает исполнение рейса; муниципальные и межмуниципальные схемы могут меняться.'},
 {'id':'schedule','name':'ЧТУ · расписание','url':'https://xn--21-qmces.xn--p1ai/raspis.html','date':'на странице расписание от 01.06.2026; проверено 09.10.2026','use':'Проверен официальный источник для последующего сопоставления рейсов.','limit':'Расписание представлено изображениями; ссылка Минтранса вернула HTTP 418. Машиночитаемый график на даты GPS не получен; опоздания относительно расписания не вычисляются.'},
 {'id':'population','name':'Чувашстат · население городского округа','url':'https://21.rosstat.gov.ru/folder/150392/document/265966','date':'оценка на 01.01.2025; проверено 09.10.2026','use':'Опубликовано около 507 тыс. жителей Чебоксарского городского округа; это контекст масштаба территории.','limit':'Не население вырезки и не распределение жителей по домам. Поисковая версия доступна, прямой запрос вернул 502. Жители не распределяются по остановкам; OSM-здания — только прокси потенциального спроса.'},
 {'id':'crashes','name':'Госавтоинспекция · статистика ДТП','url':'https://stat.gibdd.ru/','date':'попытка доступа 09.10.2026','use':'Проверена доступность официального источника.','limit':'Запрос завершился тайм-аутом; геокодированные ДТП не получены. Для всех карточек данные ДТП = нет данных; отсутствие аварий не утверждается.'},
 {'id':'standards','name':'Росстандарт · ГОСТ Р 70716-2023','url':'https://protect.gost.ru/gost/details/ec825dd5-abe3-4062-8a19-63ddf5cef45f','date':'введён 01.05.2023; статус «Действует» проверен 09.10.2026','use':'Основание включить проверку безопасности пешеходов в программу обследования.','limit':'Карточка стандарта не является экспертизой проекта. До проектирования проверить актуальные редакции и применимость ГОСТ Р 52289, СП 42.13330 и СП 59.13330, требования владельца дороги.'}]
LABELS={'benefit':'польза','safety':'безопасность','accessibility':'доступность','feasibility':'реализуемость','evidence':'доказательства'}
def nearest(p):return min((i for i,s in enumerate(STOPS) if s['inMap'] and s['type']=='0'),key=lambda i:distance(p,(STOPS[i]['lon'],STOPS[i]['lat'])))
def src(*ids):return [{'name':s['name'],'url':s['url']} for s in SOURCES if s['id'] in ids]
def add_osm(sources,kind,ident):return sources+[{'name':f'OSM {kind} {ident}','url':f'https://www.openstreetmap.org/{kind}/{ident}'}]
def main():
 a=json.loads((OUT/'audit.json').read_text());t=json.loads((OUT/'transport.json').read_text());access=json.loads((OUT/'access.json').read_text());candidates=[]
 def card(title,p,status,problem,evidence,proposal,mechanism,limit,fieldwork,ratings,sources,**extra):
  candidates.append(dict(id=f'm{len(candidates)+1:02}',title=title,lon=p[0],lat=p[1],status=status,problem=problem,evidence=evidence,proposal=proposal,mechanism=mechanism,limit=limit,fieldwork=fieldwork,ratings=dict(zip(WEIGHTS,ratings)),sources=sources,
   confidence='высокая для наблюдения, средняя для причины' if status=='подтверждённое наблюдение' else 'средняя' if status=='обоснованная гипотеза' else 'низкая без натурной проверки',**extra))
 terms=[s for s in STOPS if s['inMap'] and 'конеч' in (s['description']+' '+s['name']).lower()]
 safe_slow=[v for v in t['segments'] if v['kind']=='будний' and v['period'] in ['утро','вечерний пик'] and v['location']=='между остановками' and len(v['days'])>=10 and v['slowDays']>=8 and 3<v['speed']<12 and v['vehicles']>=10 and v['n']>=150 and v['median']>5 and min(distance((v['lon'],v['lat']),(s['lon'],s['lat'])) for s in terms)>300]
 selected=[];seen=set()
 for v in sorted(safe_slow,key=lambda x:x['speed']):
  if tuple(v['cell']) in seen:continue
  seen.add(tuple(v['cell']));selected.append(v)
  if len(selected)==4:break
 for v in selected:
  p=(v['lon'],v['lat']);i=nearest(p);s=STOPS[i];ci=v['speedCI'];nearrows=[z for z in t['segments'] if z['cell']==v['cell'] and z['route']==v['route'] and z['kind']==v['kind'] and z['period']==v['period'] and z['direction']!=v['direction'] and len(z['days'])>=5 and z['location']==v['location']]
  contrasts=[f"Другой курс {['С','В','Ю','З'][z['direction']]}: {z['speed']:.1f} км/ч, {len(z['days'])} дней (состав сегментов может различаться)." for z in nearrows[:2]]
  card('Замедление: '+s['name'],p,'подтверждённое наблюдение','Повторяется малая скорость наблюдаемого транспорта на участке сетки 250 м; причина не установлена.',
   [f"{v['route']}, курс {['С','В','Ю','З'][v['direction']]}, {v['period']} ({PERIODS[v['period']][0]}–{PERIODS[v['period']][1]} МСК), будни. Средняя {v['speed']:.1f} км/ч, 95% ДИ по дням {ci[0]:.1f}–{ci[1]:.1f}; P10/P50/P90 {v['p10']:.1f}/{v['median']:.1f}/{v['p90']:.1f}.",
    f"{len(v['days'])} дней, {v['vehicles']} машин, {v['n']} сегментов; {v['slowDays']} дней со средней <12 км/ч. Доля времени <5 км/ч {v['slowShare']*100:.1f}%. Даты: {', '.join(v['days'])}."]+contrasts,
   'Обследовать задержки; при подтверждении светофорной причины рассмотреть транспортный приоритет, настройку фаз или организацию подхода к остановке.',
   'Уменьшение повторяющихся задержек может улучшить время поездки и регулярность. Эффект в минутах не рассчитан.',
   'Середина сегмента вне радиуса 70 м не исключает стоянку на части сегмента. GPS не измеряет загрузку всей дороги. Клетка может содержать несколько улиц; ближайшая остановка — ориентир. Терминальные клетки отсеяны, остаточная стоянка возможна.',
   'Проехать с журналом открытия дверей; измерить очереди и задержки по фазам, контрольное время движения, фактическую полосу и остановку. Сверить маршрут и график с оператором.',
   [4,3,3,3,4],src('gps','stops','routes'),stop=i,type='speed',metric=v)
 head=[v for v in t['intervals'] if v['kind']=='будний' and v['n']>=80 and len(v['days'])>=10 and v['cv']>=.8 and v['p90']>=15]
 seen_routes=set()
 for v in sorted(head,key=lambda x:-x['n']):
  if v['route'] in seen_routes:continue
  seen_routes.add(v['route']);s=STOPS[v['stop']];ci=v['medianCI']
  card('Регулярность: '+s['name'],(s['lon'],s['lat']),'подтверждённое наблюдение','Наблюдаемые интервалы сильно различаются; зафиксированы короткие следования и длинные разрывы.',
   [f"{v['route']}, rid {v['sourceRoute']}, курс {['С','В','Ю','З'][v['direction']]}, {v['period']}, будни: медиана {v['median']:.1f} мин, P90 {v['p90']:.1f} мин, CV {v['cv']:.2f}.",
    f"{v['n']} интервалов за {len(v['days'])} дней; H≤2 мин: {v['bunches']}, длинные разрывы: {v['longGaps']}; исключено {v['censored']} интервалов. 95% ДИ медианы {ci[0]:.1f}–{ci[1]:.1f} мин. Условное E(W) {v['wait']:.1f} мин; ДИ {v['waitCI']}.",
    'Даты: '+', '.join(v['days'])],
   'Сверить с рейсами оператора и натурным журналом; при подтверждении рассмотреть регулирование интервалов и навигацию о следующем рейсе.',
   'Более ровные интервалы уменьшают случайное ожидание; нельзя оценить пассажирскую пользу без спроса и полной записи рейсов.',
   'Входы в 70 м могут пропускаться или относиться к соседней стороне. Полнота отдельных машин неизвестна; это не доказательство нарушения расписания. E(W) — только сценарий случайного прихода.',
   'Считать фактические проезды и посадки в оба направления в те же часы; сверить пропуски GPS, диспетчерский журнал, работу табло и доступность посадочной площадки.',
   [4,2,3,4,4],src('gps','stops','schedule','routes'),stop=v['stop'],type='headway',metric=v)
  if len(seen_routes)>=3:break
 # Three paired-stop hypotheses, explicitly including EXISTING nearby crossings.
 for name in ['Детский парк Николаева','Дом печати','Кочаково']:
  v=next(x for x in access['stops'] if STOPS[x['stop']]['name']==name and x['partner'] and x['partner']['distance']);s=STOPS[v['stop']];p=v['partner'];cross=v['crossing'];road=v['road'];tags=road['tags'] if road else {}
  card('Связь остановок: '+name,(s['lon'],s['lat']),'обоснованная гипотеза','В нанесённой сети путь между одноимёнными остановками значительно длиннее прямого расстояния. Наличие проблемы на местности не подтверждено.',
   [f"Путь OSM {p['distance']:.0f} м против {p['straightDistance']:.0f} м по прямой (×{p['detourRatio']:.2f}); доп. длина модели {p['distance']-p['straightDistance']:.0f} м, не ожидаемый эффект строительства.",
    f"Существующий переход OSM №{cross['id']} в {cross['distance']:.0f} м по прямой от остановки: {cross['tags']}. Следовательно, нельзя утверждать, что переход отсутствует.",
    f"Ближайшая дорожная линия: {tags.get('name','без имени')}; lanes={tags.get('lanes','нет данных')} для этой линии/проезжей части, maxspeed={tags.get('maxspeed','нет данных')} — тег, не измеренная скорость. Потенциальные OSM-объекты в 400 м по прямой: {v['potentialObjects']}."] ,
   'Проверить существующий переход и проходы; исправить картографическую связность. При реальном обходе рассмотреть соединение площадок с переходом, доступные бордюры и навигацию; новый переход — только после отдельного обоснования.',
   'Непрерывный безопасный путь может сократить обход при смене направления и пересадке; величина эффекта зависит от фактического пути.',
   'Модель соединяет остановку с ребром не далее 30 м. Отсутствующий OSM-коннектор к уже существующему переходу может полностью объяснять обход. Парность по имени — гипотеза; lanes не сумма полос двух проезжих частей. ДТП, видимость и реальные скорости: нет данных.',
   'Пройти обе связи и зафиксировать входы, ограждения и существующие переходы; измерить пешеходные направления и потоки, все полосы, скорости автомобилей (включая V85), видимость, освещение, бордюры и ДТП за несколько лет. Проверить актуальные нормы и согласование владельца дороги.',
   [4,4,4,3,2],add_osm(src('osm','stops','standards','crashes'),'node',cross['id']),stop=v['stop'],type='transfer',metric=v)
 for needle in ['ДЮСШ №4','Школа искусств']:
  p=next(p for p in access['pois'] if needle in p['name'] and p['distance']);i=nearest(p['point']);s=STOPS[i]
  card('Подход: '+p['name'],p['point'],'обоснованная гипотеза','В OSM от объекта до сети ближайших остановок получается длинный путь; прямой круг переоценивает доступность.',
   [f"{p['tags'].get('addr:street','')}, {p['tags'].get('addr:housenumber','')}; сетевой путь до любой привязанной остановки {p['distance']:.0f} м, ближайшая по прямой {p['straightDistance']:.0f} м, отношение {p['detourRatio']}; школьный объект — прокси потенциального спроса.",
    f"За 10 мин при 4,5 км/ч бюджет 750 м: объект за пределом расчётной доступности. Привязка к пути {p['snap']['offset']:.1f} м; точка — центр OSM-объекта, не проверенный вход."],
   'Обследовать входы и маршрут детей; проверить нанесённость короткого прохода. При реальном разрыве рассмотреть дорожку к существующему переходу или изменение остановки после проверки маршрута и безопасности.',
   'Непрерывный подход может уменьшить обход к учебному объекту; спрос и количественная польза не измерены.',
   'Геометрия входов и расписание учреждения неизвестны. Модель не доказывает отсутствие физического короткого пути; ближайшая по прямой остановка может отличаться от достигнутой по сети.',
   'Пройти от фактического входа до остановок в обоих направлениях; проверить ворота, зимнее содержание, свет, ширину и бордюры; наблюдать поток детей. Проверить варианты добавления/переноса остановки с оператором.',
   [3,5,4,3,2],add_osm(src('osm','stops','standards'),p['osmType'],p['id']),stop=i,type='approach',metric=p)
 for name in ['Автостанция "Привокзальная"','Благовещенский мкр.']:
  v=next(x for x in access['stops'] if STOPS[x['stop']]['name']==name and x['snap'] is None);s=STOPS[v['stop']]
  card('Проверить подходы: '+name,(s['lon'],s['lat']),'место для обследования','Остановка не имеет допустимой привязки к нанесённой пешей сети в пределах 30 м.',
   ['Привязка отклонена: нет близкого разрешённого ребра или соединение пересекает дорожную ось/ограждение.',f"Потенциальные OSM-объекты в 400 м по прямой: {v['potentialObjects']}. Это приоритет обследования, не число пассажиров."],
   'Снять положение посадочной площадки и пути, обновить OSM; по результату рассмотреть тротуарный коннектор, доступную площадку, навес, свет и указатели пересадки.',
   'Проверка выявит реальный путь и условия ожидания; улучшение непрерывности подхода особенно полезно людям с колясками.',
   'Нет связности в модели не означает отсутствие тротуара. Координата каталога может находиться на проезжей части. Наличие навеса, освещения и состояние покрытия не обследованы.',
   'Сверить координату с фактической посадкой; обследовать входы, переходы, бордюры, ширину, уклоны, поверхность, навес, освещённость и навигацию; учитывать пересадки и движение автобусов.',
   [4,4,5,4,1],src('osm','stops'),stop=v['stop'],type='survey',metric=v)
 p=next(p for p in access['pois'] if 'Начальная школа для обучающихся с ограниченными' in p['name'])
 card('Доступный путь: школа для детей с ОВЗ №2',p['point'],'место для обследования','Путь в обычном графе есть; после консервативного исключения известных/непроверенных барьеров МГН связь не найдена.',
  [f"Обычный сетевой путь {p['distance']:.0f} м; в режиме исключения барьеров: {'нет связного пути OSM' if p['accessibleDistance'] is None else str(p['accessibleDistance'])+' м'}. Объект {p['osmType']} {p['id']}; отсутствие wheelchair=yes у ворот также исключает ребро."],
  'Проверить непрерывность доступного маршрута до входа: ворота, бордюры, уклоны, поверхность и посадку; затем выбрать локальное устранение подтверждённого барьера.',
  'Непрерывный доступный путь позволит пользоваться остановкой без ступеней или непроходимого входа.',
  'Консервативный режим исключает ворота с неизвестной доступностью и грубые поверхности. Это не доказательство невозможности проезда коляски; неизвестные теги не сертифицируют оставшиеся пути.',
  'Пройти маршрут совместно с пользователем кресла-коляски; измерить свободную ширину, продольный/поперечный уклон, высоту бордюров, доступность ворот и посадочной площадки. Сверить СП 59.13330 актуальной редакции.',
  [4,5,5,3,1],add_osm(src('osm','stops','standards'),p['osmType'],p['id']),stop=nearest(p['point']),type='accessible',metric=p)
 for c in candidates:c['score']=round(sum(c['ratings'][k]*w for k,w in WEIGHTS.items())*20,1)
 candidates.sort(key=lambda c:-c['score'])
 for i,c in enumerate(candidates):c['rank']=i+1
 export_csv('candidates',[{**c,'ratings':c['ratings']} for c in candidates]);write(OUT/'candidates.geojson',{'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[c['lon'],c['lat']]},'properties':{k:v for k,v in c.items() if k not in ['lon','lat','metric']}} for c in candidates]})
 # Common route x hour slots across all eligible dates for weekly comparisons.
 keep=set(t['selection']['eligibleDays']);eligible=[d for d in a['days'] if d['date'] in keep]
 slots=set.intersection(*({(r['route'],r['hour']) for r in d['routeHours'] if 7<=r['hour']<21 and r['coverage']>=.9 and r['vehicles']>=3} for d in eligible))
 route_hours=[];comparison_groups=defaultdict(list)
 for d in a['days']:
  raw=json.loads((RAW/'mobility'/(d['date']+'.json')).read_text());integrals=defaultdict(lambda:[0,0,set()])
  for r,rid,vid,time,seconds,meters,*_ in raw['segments']:
   if time//3600!=(time-seconds)//3600:continue
   z=integrals[(r,time//3600)];z[0]+=seconds;z[1]+=meters;z[2].add(vid)
  total_s=total_m=0
  for rh in d['routeHours']:
   r,h=rh['route'],rh['hour'];seconds,meters,vids=integrals[(r,h)];matched=d['date'] in keep and (r,h) in slots
   route_hours.append({'date':d['date'],'route':r,'hourMoscow':h,'points':rh['points'],'observedVehicles':rh['vehicles'],'binCoverage':rh['coverage'],'validVehicleHours':seconds/3600,'speedKmh':meters/seconds*3.6 if seconds else None,'matchedForComparison':matched})
   if matched:total_s+=seconds;total_m+=meters
  if d['date'] in keep:
   week=next(w for w in t['selection']['weeks'] if w[:10]<=d['date']<=w[11:]);kind=next(x['kind'] for x in t['daily'] if x['date']==d['date']);comparison_groups[(week,kind)].append((total_s,total_m))
 comparisons=[]
 for (week,kind),vs in sorted(comparison_groups.items()):
  speeds=[m/s*3.6 for s,m in vs if s];seconds=sum(s for s,m in vs)
  comparisons.append({'week':week,'kind':kind,'days':len(vs),'vehicleHours':sum(s for s,m in vs)/3600,'meanDailyVehicleHours':sum(s for s,m in vs)/3600/len(vs),'speed':sum(m for s,m in vs)/seconds*3.6 if seconds else None,'speedRange':[min(speeds),max(speeds)] if speeds else [None,None]})
 export_csv('route-hours',route_hours);export_csv('weeks',comparisons)
 territory=Counter(tuple(c) for d in a['days'] for c in d['territoryCells'])
 counts=Counter();speeds=Counter()
 for d in a['days']:counts.update(d['counts']);speeds.update(dict(d['speedValues']))
 audit_summary={'rawRows':counts['rawRows'],'duplicates':counts['duplicates'],'conflicts':counts['duplicateCoordinateConflicts'],'outsideFileDate':counts['outsideFileDate'],
  'speedConstant':list(speeds)==['1'],'points':sum(d['points'] for d in a['days']),'gapMedianRange':[min(d['gapSeconds']['median'] for d in a['days']),max(d['gapSeconds']['median'] for d in a['days'])],
  'gapP90Range':[min(d['gapSeconds']['p90'] for d in a['days']),max(d['gapSeconds']['p90'] for d in a['days'])]}
 # Stratified vitrine: keep representative rows for every route/kind/period.
 selected_rows={};table=[]
 for v in sorted(t['segments'],key=lambda v:(-len(v['days']),-v['n'])):
  key=(v['route'],v['kind'],v['period'],v['direction'],v['location']);n=selected_rows.get(key,0)
  if n<1:selected_rows[key]=n+1;table.append(dict(v,place=STOPS[nearest((v['lon'],v['lat']))]['name']))
 for v in selected:
  if not any(z['cell']==v['cell'] and z['route']==v['route'] and z['period']==v['period'] and z['direction']==v['direction'] and z['kind']==v['kind'] and z['location']==v['location'] for z in table):table.append(dict(v,place=STOPS[nearest((v['lon'],v['lat']))]['name']))
 interval_table=[];seen=set()
 for v in t['intervals']:
  key=(v['route'],v['kind'],v['period'],v['direction'])
  if key in seen:continue
  seen.add(key);interval_table.append(v)
 for c in candidates:
  if c['type']=='headway' and c['metric'] not in interval_table:interval_table.append(c['metric'])
 table.sort(key=lambda v:v['speed']);interval_table.sort(key=lambda v:-v['n'])
 limits=t['limits']+access['method']['limits']+['Число OSM-объектов не равно числу учреждений: территории и корпуса могут дублироваться. Население по зданиям, рабочие места, пассажиропотоки, ДТП и скорости всех автомобилей не получены.',
  f'Недельное сравнение использует {len(slots)} одинаковых пар маршрут×час с ≥90% окон и ≥3 наблюдаемыми машинами в каждом из 20 дней; наблюдаемый машино-час не равен полному выпуску. Первая неделя содержит 4 будних дня.',
  'Перенос/добавление остановки, новый переход, свет, навес и посадочная площадка представлены вариантами после обследования. По GPS не заявляется их отсутствие или необходимость строительства. Количественный эффект мер не оценён.']
 findings=[f"{audit_summary['rawRows']:,} исходных строк проверены; поле speed во всех них равно 1. Типичный шаг 61–62 с; скорость рассчитана независимо.",
  '20 сопоставимых дней: 14 будних и 6 выходных. 14 сентября неполный; 5–6 октября вне выбранных недель; 7 октября содержит дневной разрыв. Часы после 21:00 не сравниваются.',
  f"В районе «{STOPS[nearest((selected[0]['lon'],selected[0]['lat']))]['name']}» средняя скорость {selected[0]['route']} утром {selected[0]['speed']:.1f} км/ч в {len(selected[0]['days'])} будних днях. Причина задержки требует проезда и наблюдения фаз.",
  'Детский парк Николаева, Дом печати и Кочаково: модель показывает обходы между остановками, хотя рядом уже нанесены переходы. Сначала проверить подходы и связность карты.',
  f"Из {access['summary']['stops']} наземных остановок привязаны к явной сети {access['summary']['snappedStops']}; для {access['summary']['stops']-access['summary']['snappedStops']} привязки нет. Это недостаток сведений, не доказанная недоступность."]
 ranking='Оценка = 20 × (0,25×польза + 0,25×безопасность + 0,20×доступность + 0,15×реализуемость + 0,15×доказательства). Каждый критерий 1–5, это экспертный приоритет обследования, не расчёт окупаемости. Польза: 1 — единичный объект, 3 — локальная связь, 4 — повторяемая проблема или много объектов, 5 — подтверждённый массовый спрос (не установлен). Безопасность: 2 — регулярность, 3 — задержки, 4 — связь через дорогу, 5 — детский/уязвимый объект; риск ДТП этим баллом не измерен. Доступность: 3 — общий путь, 4 — детские/пешеходные связи, 5 — непрерывность МГН. Реализуемость: 3 — требуется согласование, 4 — первичное обследование/оперативная проверка. Доказательства: 1 — разрыв OSM, 2 — модельная гипотеза, 4 — повторяемое GPS-наблюдение с ДИ; 5 требует независимой полевой проверки. Веса выбраны экспертно; карточки содержат все баллы, равные оценки сохраняют порядок формирования.'
 report={'version':1,'asOf':'2026-10-09','bounds':BOUNDS,'auditSummary':audit_summary,'archive':a['archive'],
  'days':[{k:d[k] for k in ['date','hours','vehicles','routes','points','start','end']} for d in a['days']],
  'selection':t['selection'],'sources':SOURCES,'findings':findings,'candidates':candidates,'segments':table,'intervals':interval_table,'accessSummary':access['summary'],
  'comparison':comparisons,'matchedRouteHourSlots':sorted(slots),'territory':[{'lon':center(*c)[0],'lat':center(*c)[1],'days':n} for c,n in territory.items()],
  'weights':WEIGHTS,'ratingLabels':LABELS,'rankingMethod':ranking,'limits':limits}
 write(OUT/'report.json',report);write(OUT/'sources.json',SOURCES)
 standalone(report);print('Report:',len(candidates),'cards',len(table),'vitrine cells',len(interval_table),'interval groups',len(slots),'matched route-hour slots')
def standalone(r):
 esc=html.escape
 body='<h1>Чебоксары: транспорт и подходы к остановкам</h1><p>Расчёт от 09.10.2026 · <a href="./#mobilityTitle">Открыть карту</a></p><ul>'+''.join('<li>'+esc(x)+'</li>' for x in r['findings'])+'</ul><h2>Приоритетные места</h2>'
 for c in r['candidates']:
  body+=f"<article id='{c['id']}'><h3>{c['rank']}. {esc(c['title'])} · {c['score']}/100</h3><p>{esc(c['status'])} · {c['lat']:.6f}, {c['lon']:.6f} · {esc(c['confidence'])}</p><p>{esc(c['problem'])}</p><ul>"+''.join('<li>'+esc(x)+'</li>' for x in c['evidence'])+'</ul>'
  for label,key in [('Рассмотреть','proposal'),('Механизм пользы','mechanism'),('Ограничения','limit'),('На месте','fieldwork')]:body+='<p><b>'+label+':</b> '+esc(c[key])+'</p>'
  body+='<p>Баллы: '+esc(str(c['ratings']))+'</p><p>'+''.join(f'<a href="{esc(s["url"])}">{esc(s["name"])}</a> · ' for s in c['sources'])+'</p></article>'
 body+='<h2>Методика и ранжирование</h2><p>'+esc(r['rankingMethod'])+'</p><ul>'+''.join('<li>'+esc(x)+'</li>' for x in r['limits'])+'</ul><h2>Источники</h2>'
 for s in r['sources']:body+=f'<p><a href="{esc(s["url"])}">{esc(s["name"])}</a> · {esc(s["date"])}. {esc(s["use"])} {esc(s["limit"])}</p>'
 body+='<h2>Воспроизводимость и экспорт</h2><p>Скрипты: extract_mobility_osm.py → analyze_mobility.py --audit → --transport → analyze_access.py → build_mobility_report.py. Сырые данные сохраняются вне сайта. Дневной SHA-256 и параметры в аудите. Исторический каталог остановок не получен.</p><p>'+''.join(f'<a href="data/mobility/{f}" download>{esc(f)} ↓</a> · ' for f in ['audit.json','route-hours.csv','weeks.csv','segments.csv','intervals.csv','access.csv','candidates.csv','candidates.geojson','transport.json','access.json'])+'</p>'
 doc='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Чебоксары · доказательный транспортный анализ</title><style>body{max-width:920px;margin:32px auto;padding:0 18px;font:16px/1.65 system-ui;color:#24323a}h1{font-size:28px}h2{margin-top:36px}article{border-top:1px solid #ddd;padding:18px 0}a{color:#216c8c;overflow-wrap:anywhere}li{margin-bottom:6px}@media print{body{font-size:10pt}article{break-inside:avoid}}</style>'+body+'</html>'
 (ROOT/'dist/mobility-report.html').write_text(doc)
if __name__=='__main__':main()
