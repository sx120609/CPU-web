"""Download a bounded, georeferenced research mosaic; never a live runtime dependency."""
import argparse
import concurrent.futures
import hashlib
import json
import math
from io import BytesIO
from pathlib import Path
import urllib.request
from urllib.parse import urlencode
from PIL import Image

parser=argparse.ArgumentParser()
parser.add_argument('--bbox',nargs=4,type=float,required=True,metavar=('W','S','E','N'))
parser.add_argument('--zoom',type=int,default=18)
parser.add_argument('--name',required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--retrieved',required=True)
args=parser.parse_args()
west,south,east,north=args.bbox
if not (-180<=west<east<=180 and -85<south<north<85 and 0<=args.zoom<=23):parser.error('Invalid extent or zoom')
if not args.name.replace('-','').replace('_','').isalnum():parser.error('Name must contain letters, digits, hyphens or underscores')
if any((args.output/f'{args.name}{suffix}').exists() for suffix in ['.png','-georef.json']):
 parser.error('Capture name already exists; choose a new name to preserve its image/metadata pair')
def tile(lon,lat):
 n=2**args.zoom
 return ((lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
x0,y0=map(math.floor,tile(west,north));x1,y1=map(math.floor,tile(east,south))
if (x1-x0+1)*(y1-y0+1)>128:parser.error('Extent exceeds the 128-tile research limit')
args.output.mkdir(parents=True,exist_ok=True)
service='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
def get(q):
 x,y=q;url=f'{service}/tile/{args.zoom}/{y}/{x}'
 # Fetch fresh bytes for each capture: reusing an old tile with today's metadata
 # would silently misdate the evidence. Preserve earlier captures by content hash.
 with urllib.request.urlopen(url,timeout=30) as response:data=response.read()
 with Image.open(BytesIO(data)) as im:
  if im.size!=(256,256):raise ValueError('Unexpected tile dimensions')
 digest=hashlib.sha256(data).hexdigest()
 path=args.output/f'esri-{args.zoom}-{y}-{x}-{digest[:12]}.jpg'
 if not path.exists():path.write_bytes(data)
 return x,y,Image.open(BytesIO(data)).convert('RGB'),{'url':url,'sha256':digest,'localFile':path.name}
mosaic=Image.new('RGB',((x1-x0+1)*256,(y1-y0+1)*256));tiles=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for x,y,image,source in pool.map(get,[(x,y) for y in range(y0,y1+1) for x in range(x0,x1+1)]):
  mosaic.paste(image,((x-x0)*256,(y-y0)*256));tiles.append(source)
# Inspect date/accuracy metadata at the center. This is one sample, not a guarantee
# that every tile in an arbitrary extent has the same acquisition date.
lon,lat=(west+east)/2,(south+north)/2
service_url=f'{service}?f=json'
with urllib.request.urlopen(service_url,timeout=30) as response:service_info=json.load(response)
# Select the metadata visible at the actual tile LOD, not a fixed resolution layer.
# Layer IDs can change; use the service's advertised scale ranges and keep them in
# the evidence record. Zero means that end of the scale range is unbounded.
lod=next((q for q in service_info.get('tileInfo',{}).get('lods',[]) if q['level']==args.zoom),None)
if lod is None:raise ValueError('Service does not advertise this zoom level')
scale=lod['scale']
layers=[q for q in service_info.get('layers',[]) if q['name'].endswith('Resolution Metadata')
        and (not q.get('minScale') or scale<=q['minScale'])
        and (not q.get('maxScale') or scale>q['maxScale'])]
if len(layers)!=1:raise ValueError(f'Expected one metadata layer for zoom {args.zoom}, found {len(layers)}')
layer=layers[0]
query=f"{service}/{layer['id']}/query?"+urlencode({
 'where':'1=1','geometry':f'{lon},{lat}','geometryType':'esriGeometryPoint','inSR':4326,
 'outFields':'SRC_DATE,SRC_ACC,SRC_RES,SRC_DESC,BlockName,ReleaseName,MinMapLevel,MaxMapLevel,DrawOrder',
 'returnGeometry':'false','f':'json'})
with urllib.request.urlopen(query,timeout=30) as response:metadata=json.load(response)
if 'error' in metadata:raise ValueError(f"Metadata query failed: {metadata['error']}")
for feature in metadata.get('features',[]):
 attrs=feature['attributes']
 if not attrs['MinMapLevel']<=args.zoom<=attrs['MaxMapLevel']:
  raise ValueError('Metadata feature does not cover the requested zoom; do not date these tiles from it')
info={'zoom':args.zoom,'tileOrigin':[x0,y0],'pixelSize':list(mosaic.size),'requestedBbox':args.bbox,
 'service':service,'retrieved':args.retrieved,'metadataSample':{'point':[lon,lat],
 'scope':'center point only; not a date guarantee for the whole mosaic',
 'status':'found' if metadata.get('features') else 'unavailable',
 'layerSelection':{'serviceUrl':service_url,'lod':lod,'layer':layer},'url':query,'response':metadata},
 'attribution':'Esri, Vantor, Earthstar Geographics, GIS User Community','tiles':tiles}
mosaic.save(args.output/f'{args.name}.png')
(args.output/f'{args.name}-georef.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf8')
print(json.dumps({'name':args.name,'tiles':len(tiles),'pixelSize':mosaic.size,'metadata':metadata.get('features')}))
