"""Live HTTP smoke check. Seed, restart the server, then verify and clean up."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'.tmp'/'live-smoke.json'

def request(path,method='GET',body=None,expected=200,raw=False):
    data=body if raw else (json.dumps(body,ensure_ascii=False).encode() if body is not None else None)
    req=Request('http://127.0.0.1:8000'+path,data=data,method=method,
                headers={'Content-Type':'audio/mpeg' if raw else 'application/json'})
    try:
        with urlopen(req,timeout=10) as response:
            status,payload=response.status,response.read()
    except HTTPError as error:
        status,payload=error.code,error.read()
    assert status==expected,(path,status,payload[:500])
    return json.loads(payload) if payload else None

def seed():
    uid=lambda:str(uuid4())
    song={'schemaVersion':1,'id':uid(),'title':'Временная проверка сохранения','artist':'',
          'language':'ru','palette':[{'id':uid(),'name':'Am'}],
          'sections':[{'id':uid(),'name':'Куплет','lines':[{'id':uid(),'text':'Моя строка 🎸','chords':[]}]}],
          'performance':{'fontSize':24,'bpm':90,'beats':4},'audio':None,
          'updatedAt':'2026-10-25T12:00:00Z','source':'manual'}
    created=request('/api/songs','POST',song,201)
    song['title']='Сохранено после изменения'
    request('/api/songs/'+song['id'],'PUT',song)
    assert request('/api/songs/'+song['id']+'/export')==song
    copy=request('/api/import','POST',song,201)
    assert copy['id']!=song['id'] and copy['audio'] is None
    request('/api/import','POST',{'schemaVersion':999},422)
    request('/api/songs/'+song['id']+'/audio?filename=invalid.mp3','PUT',b'not audio',422,raw=True)
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps({'original':song['id'],'copy':copy['id']}),encoding='utf8')
    print('Live HTTP: create, edit, export/import and invalid files passed. Restart server, then run verify.')

def verify():
    state=json.loads(STATE.read_text(encoding='utf8'))
    assert request('/api/songs/'+state['original'])['title']=='Сохранено после изменения'
    for identifier in state.values():
        request('/api/songs/'+identifier,'DELETE',expected=204)
    STATE.unlink()
    print('Live HTTP: persistence after process restart passed. Only test-created songs were removed.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['seed','verify'])
    args=parser.parse_args()
    seed() if args.mode=='seed' else verify()
