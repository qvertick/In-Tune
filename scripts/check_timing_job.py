"""Isolated end-to-end MP3 timing job using an existing local speech fixture."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'backend/.deps'),str(ROOT)]
from fastapi.testclient import TestClient
from backend.main import create_app

def main():
    with tempfile.TemporaryDirectory() as directory:
        mp3=Path(directory)/'speech.mp3'
        subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-i',str(ROOT/'.tmp/voice-follow-ru.wav'),str(mp3)],check=True,
                       creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        song=json.loads((ROOT/'.tmp/timeline-benchmark.song.json').read_text(encoding='utf8'))
        for section in song['sections']:
            for line in section['lines']:
                for key in ('words','start','end','timingReview'):line.pop(key,None)
        with TestClient(create_app(directory)) as client:
            assert client.post('/api/songs',json=song).status_code==201
            upload=client.put('/api/songs/'+song['id']+'/audio?filename=speech.mp3',content=mp3.read_bytes(),headers={'Content-Type':'audio/mpeg'})
            assert upload.status_code==200,upload.text
            task=client.post('/api/songs/'+song['id']+'/analysis?kind=timing')
            assert task.status_code==202,task.text
            task_id=task.json()['id']; deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                status=next(j for j in client.get('/api/jobs').json() if j['id']==task_id)
                if status['status'] not in ('queued','running'):break
                time.sleep(.1)
            assert status['status']=='completed',status
            result=client.get('/api/jobs/'+task_id+'/result').json()
            rows=[l for s in result['sections'] for l in s['lines']]
            assert sum('start' in l for l in rows)==4
            saved=client.get('/api/songs/'+song['id']).json()
            assert all('start' not in l for s in saved['sections'] for l in s['lines'])
            imported=client.post('/api/jobs/'+task_id+'/import-result')
            assert imported.status_code==201,imported.text
            restored=imported.json()
        # A new app process/lifespan reopens the same persistent SQLite files.
        with TestClient(create_app(directory)) as client:
            reopened=client.get('/api/songs/'+restored['id']).json()
            assert reopened['sections']==restored['sections'] and reopened['audio']
        print(json.dumps({'mp3Decoded':True,'job':'completed','timedLines':4,
                          'originalUntouched':True,'copyReopenedWithAudio':True}))

if __name__=='__main__':main()
