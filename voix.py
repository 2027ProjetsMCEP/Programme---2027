# Génère la voix off de chaque scène avec plusieurs voix françaises de synthèse sous licence libre,
# puis la retranscrit automatiquement (Whisper) pour vérifier que la voix dit bien le texte,
# et estime la naturalité de chaque voix (score UTMOS, de 1 à 5).
# Lancé par GitHub Actions : l'atelier de travail ne peut pas télécharger les modèles.
import json
import os
import traceback
import urllib.request
import wave

import numpy as np
import soundfile as sf

T = json.load(open("texte.json"))["scenes"]
os.makedirs("voix", exist_ok=True)
res = {"voix": {}, "erreurs": {}, "licences": {}}


def save(name, sid, audio, sr):
    d = "voix/" + name
    os.makedirs(d, exist_ok=True)
    p = "%s/%s.wav" % (d, sid)
    sf.write(p, np.asarray(audio, dtype=np.float32), sr, subtype="PCM_16")
    res["voix"].setdefault(name, {})[sid] = {"fichier": p, "duree": round(len(audio) / sr, 2)}


# 1. Kokoro (modèle sous licence Apache 2.0), voix française ff_siwis
try:
    import torch  # noqa: F401
    from kokoro import KPipeline

    pipe = KPipeline(lang_code="f")
    for speed in (1.05,):
        name = "kokoro-siwis-%s" % speed
        for s in T:
            parts = []
            for r in pipe(s["texte"], voice="ff_siwis", speed=speed, split_pattern=None):
                a = r.audio if hasattr(r, "audio") else r[2]
                parts.append(a.detach().cpu().numpy() if hasattr(a, "detach") else np.asarray(a))
            save(name, s["id"], np.concatenate(parts), 24000)
        print(name, "ok", flush=True)
    res["licences"]["kokoro"] = "Kokoro-82M : licence Apache 2.0 (hexgrad/Kokoro-82M) ; voix ff_siwis entraînée sur le corpus SIWIS (CC BY 4.0)"
except Exception:  # noqa: BLE001
    res["erreurs"]["kokoro"] = traceback.format_exc()[-1500:]
    print(res["erreurs"]["kokoro"], flush=True)

# 2. Piper (voix françaises de rhasspy/piper-voices)
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/%s/%s/"
PIPER = [("tom", "medium", [None]), ("upmc", "medium", [1])]
try:
    from piper import PiperVoice
    try:
        from piper import SynthesisConfig
    except ImportError:
        SynthesisConfig = None
    os.makedirs("modeles", exist_ok=True)
    for nom, q, speakers in PIPER:
        try:
            base = HF % (nom, q)
            f = "fr_FR-%s-%s" % (nom, q)
            for suf in (".onnx", ".onnx.json"):
                urllib.request.urlretrieve(base + f + suf, "modeles/" + f + suf)
            try:
                card = urllib.request.urlopen(base + "MODEL_CARD", timeout=60).read().decode("utf-8", "replace")
                res["licences"]["piper-" + nom] = card[:1200]
            except Exception:  # noqa: BLE001
                pass
            voice = PiperVoice.load("modeles/" + f + ".onnx")
            for spk in speakers:
                name = "piper-%s%s" % (nom, "" if spk is None else "-%d" % spk)
                for s in T:
                    tmp = "modeles/tmp.wav"
                    with wave.open(tmp, "wb") as wf:
                        if SynthesisConfig is not None:
                            voice.synthesize_wav(s["texte"], wf, syn_config=SynthesisConfig(speaker_id=spk))
                        else:
                            voice.synthesize(s["texte"], wf, speaker_id=spk)
                    a, sr = sf.read(tmp)
                    save(name, s["id"], a, sr)
                print(name, "ok", flush=True)
        except Exception:  # noqa: BLE001
            res["erreurs"]["piper-" + nom] = traceback.format_exc()[-1500:]
            print(res["erreurs"]["piper-" + nom], flush=True)
except Exception:  # noqa: BLE001
    res["erreurs"]["piper"] = traceback.format_exc()[-1500:]

# 2 bis. Kyutai TTS 1.6B en_fr (licence CC BY 4.0), voix françaises du dépôt kyutai/tts-voices
try:
    import torch
    from huggingface_hub import list_repo_files, hf_hub_download
    from moshi.models.loaders import CheckpointInfo
    from moshi.models.tts import TTSModel

    files = list_repo_files("kyutai/tts-voices")
    fr = [f for f in files if f.endswith(".wav") and ("/fr/" in f or "fr_" in f.split("/")[-1] or "french" in f.lower())]
    res["kyutai_voix_fr_disponibles"] = fr[:60]
    try:
        res["licences"]["kyutai-voices-readme"] = open(hf_hub_download("kyutai/tts-voices", "README.md")).read()[:3000]
    except Exception:  # noqa: BLE001
        pass
    ci = CheckpointInfo.from_hf_repo("kyutai/tts-1.6b-en_fr")
    try:
        tts = TTSModel.from_checkpoint_info(ci, n_q=32, temp=0.6, device=torch.device("cpu"), dtype=torch.float32)
    except TypeError:
        tts = TTSModel.from_checkpoint_info(ci, n_q=32, temp=0.6, device=torch.device("cpu"))
    choix = [f for f in fr if "unmute" in f][:2] + [f for f in fr if "cml" in f][:2]
    for vf in choix[:3]:
        name = "kyutai-" + vf.split("/")[-1].replace(".wav", "")[:40]
        cond = tts.make_condition_attributes([tts.get_voice_path(vf)], cfg_coef=2.0)
        for s in T:
            entries = tts.prepare_script([s["texte"]], padding_between=1)
            pcms = []

            def on_frame(frame):
                if (frame != -1).all():
                    pcm = tts.mimi.decode(frame[:, 1:, :]).cpu().numpy()
                    pcms.append(np.clip(pcm[0, 0], -1, 1))

            with tts.mimi.streaming(1), torch.no_grad():
                tts.generate([entries], [cond], on_frame=on_frame)
            save(name, s["id"], np.concatenate(pcms, axis=-1), tts.mimi.sample_rate)
        print(name, "ok", flush=True)
except Exception:  # noqa: BLE001
    res["erreurs"]["kyutai"] = traceback.format_exc()[-2500:]
    print(res["erreurs"]["kyutai"], flush=True)

# 3. Vérification : retranscription automatique de chaque fichier
try:
    from faster_whisper import WhisperModel

    m = WhisperModel("medium", device="cpu", compute_type="int8")
    for name, scenes in res["voix"].items():
        for sid, v in scenes.items():
            segs, _ = m.transcribe(v["fichier"], language="fr", beam_size=5)
            v["entendu"] = " ".join(x.text.strip() for x in segs)
        print("whisper", name, flush=True)
except Exception:  # noqa: BLE001
    res["erreurs"]["whisper"] = traceback.format_exc()[-1500:]

# 4. Naturalité estimée (UTMOS22, prédicteur de note d'écoute de 1 à 5)
try:
    import torch
    import torchaudio

    predictor = torch.hub.load("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True)
    for name, scenes in res["voix"].items():
        notes = []
        for sid, v in scenes.items():
            a, sr = sf.read(v["fichier"], dtype="float32")
            wav = torch.from_numpy(a if a.ndim == 1 else a.mean(1)).unsqueeze(0)
            if sr != 16000:
                wav = torchaudio.functional.resample(wav, sr, 16000)
            with torch.no_grad():
                n = float(predictor(wav[:1], 16000))
            v["utmos"] = round(n, 2)
            notes.append(n)
        res.setdefault("utmos_moyen", {})[name] = round(sum(notes) / len(notes), 2)
except Exception:  # noqa: BLE001
    res["erreurs"]["utmos"] = traceback.format_exc()[-1500:]

json.dump(res, open("resultats_voix.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(res.get("utmos_moyen", {}), indent=1))
