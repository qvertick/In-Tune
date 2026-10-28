import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.storage import Store
from backend.schema import Song


def document():
    uid=lambda:str(uuid4())
    return {'schemaVersion':1,'id':uid(),'title':'Авторский пример','artist':'Автор','language':'ru',
            'palette':[], 'sections':[{'id':uid(),'name':'Куплет','lines':[{'id':uid(),'text':'Тихий вечер','chords':[],'start':1.,'end':3.}]}],
            'performance':{'fontSize':24,'bpm':90,'beats':4},'audio':None,
            'updatedAt':'2026-10-26T12:00:00Z','source':'manual'}


def test_additive_storage_migration_does_not_rewrite_existing_documents_or_audio(tmp_path):
    song=document();text=json.dumps(song,ensure_ascii=False)
    audio=tmp_path/'audio';audio.mkdir();(audio/'original.mp3').write_bytes(b'private audio')
    with sqlite3.connect(tmp_path/'songs.sqlite3') as db:
        db.execute('CREATE TABLE songs(id TEXT PRIMARY KEY,document TEXT NOT NULL,audio_file TEXT)')
        db.execute('INSERT INTO songs VALUES (?,?,?)',(song['id'],text,'original.mp3'))
    store=Store(tmp_path)
    assert store.get(song['id'])['document']==text
    assert (audio/'original.mp3').read_bytes()==b'private audio'
    with store.connect() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==1
    Store(tmp_path)
    assert store.list()==[song]


def test_origin_export_import_and_reopen_preserves_authorship_and_times(tmp_path):
    song=document();song['origin']={'site':'akkords','url':'https://akkords.pro/songs/author/example/','author':'Автор подбора','variant':'Версия 2'}
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/api/songs',json=song).status_code==201
        exported=client.get('/api/songs/'+song['id']+'/export').json()
        imported=client.post('/api/import',json=exported).json()
        assert imported['origin']==song['origin'] and imported['sections']==song['sections']
        assert client.get('/api/follow/status').status_code==404
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/api/songs/'+song['id']).json()==song


def test_delete_song_removes_only_its_generated_stems(tmp_path):
    song=document()
    store=Store(tmp_path)
    store.create(Song.model_validate(song))
    own=tmp_path/'stems'/song['id']; own.mkdir(parents=True)
    (own/'vocals.flac').write_bytes(b'generated')
    other=tmp_path/'stems'/str(uuid4());other.mkdir()
    (other/'vocals.flac').write_bytes(b'keep')
    assert store.delete(song['id']) is True
    assert not own.exists() and (other/'vocals.flac').read_bytes()==b'keep'


@pytest.mark.parametrize('url',['javascript:alert(1)','file:///etc/passwd','https://user:pass@example.org/'])
def test_origin_cannot_create_an_executable_or_credential_link(url):
    song=document();song['origin']={'site':'source','url':url}
    with pytest.raises(ValueError):Song.model_validate(song)
