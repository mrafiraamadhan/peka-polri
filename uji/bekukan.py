"""Membekukan data uji naskah secara dapat diulang.

Pemakaian:  python uji/bekukan.py <commit> <tanggal> <jam-ISO>
Cache kasus pada <commit> diproses ulang dengan kode dan aturan yang sekarang (mode uji: tanpa mengambil
sumber baru, jam diatur ke <jam-ISO>), lalu hasilnya disalin ke uji-naskah/<tanggal>/. Berkas yang tidak
bergantung pada aturan (BMKG, GDELT, status sumber, angka dengar dan pilah) disalin dari putaran asli <commit>.
Dijalankan oleh alur kerja .github/workflows/bekukan.yml; siapa pun dapat mengulanginya dan membandingkan hasilnya."""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

commit, tanggal, jam = sys.argv[1:4]
R = Path(__file__).resolve().parents[1]
git = lambda *a: subprocess.run(["git", *a], cwd=R, capture_output=True, check=True).stdout

w = Path(tempfile.mkdtemp())
shutil.copytree(R / "src", w / "src")
shutil.copytree(R / "config", w / "config")
(w / "data").mkdir()
for f in git("ls-tree", "--name-only", commit, "data/").decode().split():
    (w / f).write_bytes(git("show", f"{commit}:{f}"))
(w / "fx").mkdir()
env = dict(os.environ, PEKA_FIXTURE=str(w / "fx"), PEKA_NOW=jam)
subprocess.run([sys.executable, str(w / "src" / "peka_pipeline.py")], cwd=w, env=env, check=True)

out = R / "uji-naskah" / tanggal
out.mkdir(parents=True, exist_ok=True)
for f in ["kasus_terkini.json", "polda.json", "arsip_kasus.csv", "arsip_bulanan.json", "ringkasan.json"]:
    shutil.copy(w / "data" / f, out / f)
for f in ["bmkg.json", "gdelt_tren.json", "status_sumber.json"]:
    (out / f).write_bytes(git("show", f"{commit}:data/{f}"))
r = json.loads((out / "ringkasan.json").read_text(encoding="utf-8"))
L = json.loads(git("show", f"{commit}:data/ringkasan.json"))
r["langkah"]["dengar"] = L["langkah"]["dengar"]
r["langkah"]["pilah"] = L["langkah"]["pilah"]
r["hoaks_terbaru"] = L.get("hoaks_terbaru", [])
r["gempa_darurat"] = L.get("gempa_darurat", [])
r["lonjakan_nasional"] = L.get("lonjakan_nasional")
r["uji_naskah"] = {"commit_sumber": commit, "waktu_commit_utc": r["diperbarui_utc"],
                   "versi_aturan": r.get("versi_aturan"),
                   "catatan": "Cache kasus commit " + commit + " diproses ulang dengan aturan versi " + str(r.get("versi_aturan"))
                   + " tanpa pengambilan sumber baru. Angka dengar dan pilah, hoaks, gempa, GDELT, dan status sumber "
                   "disalin dari putaran asli commit itu."}
with open(out / "ringkasan.json", "w", encoding="utf-8") as fh:
    json.dump(r, fh, ensure_ascii=False, indent=1)
shutil.copy(R / "config" / "topik.json", out / "topik.json")
print("selesai:", out, r["status"])
