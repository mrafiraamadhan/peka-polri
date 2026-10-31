/* PEKA - papan pantau. Semua status dihitung oleh src/peka_pipeline.py; halaman ini hanya membaca data/. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: d });
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const URUT = ["DARURAT", "JALUR KHUSUS", "TINDAK", "PANTAU", "TERCATAT"];
  const ST = {
    "DARURAT": { ikon: "🔴", nama: "Darurat", ket: "ancaman jiwa, baru terjadi", cls: "DARURAT" },
    "JALUR KHUSUS": { ikon: "🟣", nama: "Jalur khusus", ket: "perilaku anggota, ke Propam", cls: "KHUSUS" },
    "TINDAK": { ikon: "🟠", nama: "Tindak", ket: "periksa ≤24 jam, kabar ≤72 jam", cls: "TINDAK" },
    "PANTAU": { ikon: "🟡", nama: "Pantau", ket: "pemeriksaan murah ≤24 jam", cls: "PANTAU" },
    "TERCATAT": { ikon: "🟢", nama: "Tercatat", ket: "masuk rekap pola keluhan", cls: "TERCATAT" },
  };
  const TOPIK = {
    anggota: "Perilaku anggota", perempuan_anak: "Kekerasan terhadap perempuan dan anak", narkoba: "Narkoba",
    penipuan: "Penipuan dan kejahatan daring", jalanan: "Kejahatan jalanan", konflik: "Konflik dan kerumunan",
    lalulintas: "Lalu lintas", layanan: "Layanan kepolisian", darurat: "Bencana dan keadaan darurat",
  };
  const lencana = s => `<span class="lencana s-${ST[s].cls}">${ST[s].ikon} ${ST[s].nama}</span>`;
  const D = { ringkasan: null, kasus: null, gdelt: null, bmkg: null, arsip: null, sumber: null, polda: null };
  const SITUS = /github\.io$/.test(location.hostname) ? location.origin + location.pathname : "https://mrafiraamadhan.github.io/peka-polri/";
  const BATAS_JAM = { "DARURAT": 1, "TINDAK": 72, "PANTAU": 24, "JALUR KHUSUS": 72, "TERCATAT": null };
  function qrSvg(teks) {
    try {
      if (typeof qrcode !== "function") return "";
      const q = qrcode(0, "M"); q.addData(teks); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) { return ""; }
  }
  const simpan = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } };
  const baca = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const F = { status: "", topik: "", prov: "", urut: "status", cari: "", n: 24 };
  let topikTren = "jalanan";

  // ------------------------------------------------------------ waktu
  const wib = (iso, opsi) => iso ? new Date(iso).toLocaleString("id-ID", Object.assign({ timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }, opsi || {})).replace(/\./g, ".") + " WIB" : "—";
  function lalu(iso) {
    if (!iso) return "—";
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 1) return "baru saja";
    if (m < 60) return Math.round(m) + " menit lalu";
    if (m < 48 * 60) return Math.round(m / 60) + " jam lalu";
    return Math.round(m / 1440) + " hari lalu";
  }
  const umurJam = iso => iso ? (Date.now() - new Date(iso).getTime()) / 3.6e6 : Infinity;

  // ------------------------------------------------------------ tooltip
  const tip = $("tip");
  function tunjuk(e, html) {
    tip.innerHTML = html; tip.classList.add("lihat");
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const sembunyikan = () => tip.classList.remove("lihat");

  // ------------------------------------------------------------ tema
  $("tema").addEventListener("click", () => {
    const gelapOS = matchMedia("(prefers-color-scheme: dark)").matches;
    const kini = document.documentElement.dataset.theme || (gelapOS ? "dark" : "light");
    const baru = kini === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = baru;
    $("tema").setAttribute("aria-pressed", baru === "dark" ? "true" : "false");
    try { localStorage.setItem("peka-tema", baru); } catch (e) { /* abaikan */ }
    gambarGrafik(); arsip();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", gambarGrafik);

  // ------------------------------------------------------------ tab
  const TABS = ["ringkasan", "pantau", "polda", "tren", "uji", "arsip", "sejarah", "metodologi"];
  let tabAktif = "ringkasan", lacakTunda = null;
  function buka(tab, gulir, tetapHash) {
    if (!TABS.includes(tab)) tab = "ringkasan";
    tabAktif = tab;
    document.body.dataset.tab = tab;
    document.querySelectorAll(".tabbtn").forEach(b => {
      const aktif = b.dataset.tab === tab;
      b.setAttribute("aria-selected", aktif ? "true" : "false");
      if (aktif) { const nav = document.querySelector(".tabs"); if (nav) nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: "smooth" }); }
    });
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("aktif", p.id === "tab-" + tab));
    if (!tetapHash && location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    if (gulir) {
      const atas = document.querySelector("main").getBoundingClientRect().top + scrollY - 70;
      if (scrollY > atas || gulir === "paksa") scrollTo({ top: atas, behavior: "smooth" });
    }
    requestAnimationFrame(gambarGrafik);
  }
  $("navtabs").addEventListener("click", e => { const b = e.target.closest(".tabbtn"); if (b) buka(b.dataset.tab, true); });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-ke]");
    if (a) { e.preventDefault(); buka(a.dataset.ke, "paksa"); }
  });
  function rute() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith("lacak=")) { bukaLacak(h.slice(6)); return; }
    if ($("lacak").open) $("lacak").close();
    if (h.startsWith("polda=")) { poldaPilih = h.slice(6); simpan("peka-polda", poldaPilih); if (D.kasus) { isiPolda(); lembar(); papan(); } buka("polda", false, true); return; }
    buka(h);
  }
  addEventListener("hashchange", rute);

  // ------------------------------------------------------------ data
  // ?data=uji-naskah/2026-10-30 membuka salinan data beku yang dipakai naskah (lihat folder uji-naskah/).
  const DATA_DIR = (() => { try { const v = new URLSearchParams(location.search).get("data"); return v && /^uji-naskah\/[0-9a-z\-]+$/i.test(v) ? v + "/" : "data/"; } catch (e) { return "data/"; } })();
  const SNAPSHOT = "uji-naskah/2026-10-30/";
  async function ambil(nama, dir) {
    try {
      const r = await fetch((dir || DATA_DIR) + nama + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function muat() {
    const [ri, ka, gd, bm, ar, su, po] = await Promise.all(["ringkasan.json", "kasus_terkini.json", "gdelt_tren.json", "bmkg.json", "arsip_bulanan.json", "status_sumber.json", "polda.json"].map(n => ambil(n)));
    Object.assign(D, { ringkasan: ri, kasus: ka, gdelt: gd, bmkg: bm, arsip: ar, sumber: su, polda: po });
    gambarSemua();
    if (lacakTunda) { const id = lacakTunda; lacakTunda = null; bukaLacak(id); }
  }

  function gambarSemua() {
    sampul(); spanduk(); kartuStatus(); narasi(); langkah(); prioritas(); sumber();
    isiSaring(); peta(); daftar(); isiPolda(); lembar(); papan(); titikRawan();
    lonjakanWilayah(); multi(); gempa(); hoaks(); arsip();
    gambarGrafik();
  }
  function gambarGrafik() {
    grafikTopik(); grafikTren(); grafikMulti(); grafikBps(); grafikInd(); kasus9();
  }
  let tunda;
  addEventListener("resize", () => { clearTimeout(tunda); tunda = setTimeout(gambarGrafik, 150); });

  // ------------------------------------------------------------ sampul & spanduk
  function sampul() {
    const r = D.ringkasan, dot = $("denyut");
    if (!r) { dot.className = "denyut mati"; $("pil-teks").textContent = "Pantauan langsung belum tersedia"; $("m-waktu").textContent = "—"; return; }
    const s = r.status, jam = umurJam(r.diperbarui_utc);
    dot.className = "denyut" + (jam > 3 ? " basi" : "");
    const bag = [];
    bag.push(s["DARURAT"] ? `${s["DARURAT"]} darurat` : "tidak ada kasus darurat");
    bag.push(`${s["TINDAK"]} berstatus Tindak`);
    if (s["JALUR KHUSUS"]) bag.push(`${s["JALUR KHUSUS"]} ke Propam`);
    $("pil-teks").textContent = (jam > 3 ? `Pantauan terlambat ${Math.round(jam)} jam · ` : "Pantauan langsung · ") + bag.join(" · ");
    const berikut = new Date(r.diperbarui_utc); berikut.setUTCMinutes(17, 0, 0); while (berikut <= new Date(r.diperbarui_utc) || berikut < Date.now() - 5 * 60000) berikut.setUTCHours(berikut.getUTCHours() + 1);
    $("m-waktu").textContent = wib(r.diperbarui_utc) + " (" + lalu(r.diperbarui_utc) + ") · putaran berikutnya sekitar " + berikut.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) + " WIB";
    const ok = D.sumber ? Object.values(D.sumber.sumber || {}).filter(x => x.ok).length : 0;
    $("m-sumber").textContent = `${ok || 4} sumber terbuka aktif`;
    $("nb-pantau").textContent = fmt(r.kasus_aktif);
  }
  function spanduk() {
    const el = $("spanduk-data");
    if (DATA_DIR !== "data/" && D.ringkasan) {
      el.innerHTML = `<div class="spanduk">Anda melihat <b>data uji yang dibekukan untuk naskah</b> (putaran ${wib(D.ringkasan.diperbarui_utc)}, aturan versi ${esc(D.ringkasan.versi_aturan || "-")}). Angka Subbab 4.3.9 naskah berasal dari data ini. <a href="./">Kembali ke pantauan langsung</a>.</div>`;
      return;
    }
    if (!D.ringkasan) {
      el.innerHTML = `<div class="spanduk">Data pantauan langsung belum ada. Pemilik repositori perlu menjalankan alur kerja <b>PEKA - dengar keluhan publik</b> sekali dari tab <b>Actions</b> di GitHub; setelah itu halaman terisi sendiri kira-kira setiap jam. Tab Uji Ambang, Sejarah &amp; Data, dan Metodologi tetap dapat dipakai.</div>`;
    } else if (umurJam(D.ringkasan.diperbarui_utc) > 3) {
      el.innerHTML = `<div class="spanduk">Putaran terakhir ${lalu(D.ringkasan.diperbarui_utc)}. Jadwal GitHub kadang mundur; data di bawah tetap hasil putaran terakhir.</div>`;
    } else el.innerHTML = "";
  }

  // ------------------------------------------------------------ ringkasan
  function resetSaring() {
    Object.assign(F, { status: "", topik: "", prov: "", cari: "", n: 24 });
    const c = $("f-cari"); if (c) c.value = "";
  }
  function kartuStatus() {
    const r = D.ringkasan, s = r ? r.status : {};
    $("r-kurun").textContent = r ? "putaran " + wib(r.diperbarui_utc, { year: undefined }) : "menunggu data";
    $("kartu-status").innerHTML = URUT.map(k => `<button type="button" class="st s-${ST[k].cls}" data-status="${k}">
      <span class="angka num">${r ? fmt(s[k]) : "–"}</span><span class="nama">${ST[k].ikon} ${ST[k].nama}</span>
      <span class="ket">${ST[k].ket}</span><span class="lihat">lihat daftarnya →</span></button>`).join("");
    $("kartu-status").querySelectorAll("[data-status]").forEach(b => b.addEventListener("click", () => {
      resetSaring(); F.status = b.dataset.status; isiSaring(); daftar(); peta(); buka("pantau", "paksa");
    }));
  }
  function narasi() {
    const r = D.ringkasan;
    if (!r) { $("narasi").textContent = "Begitu putaran pertama selesai, ringkasan kondisi muncul di sini."; return; }
    const L = r.langkah, s = r.status, kb = L.kabarkan;
    const perlu = s["DARURAT"] + s["TINDAK"] + s["JALUR KHUSUS"];
    let t = `Dalam 72 jam terakhir PEKA menyusun <b>${fmt(r.kasus_aktif)} kasus keluhan</b> dari berita daring. `;
    t += (perlu || s["PANTAU"]) ? `<b>${fmt(perlu)} kasus</b> perlu tindakan segera (${fmt(s["DARURAT"])} darurat, ${fmt(s["TINDAK"])} tindak, ${fmt(s["JALUR KHUSUS"])} jalur khusus ke Propam atau pengawas penyidikan); bersama ${fmt(s["PANTAU"])} kasus Pantau, <b>${fmt(L.teruskan.kasus)} kasus</b> diteruskan ke <b>${fmt(L.teruskan.polda)} Polda</b>. ` : "Tidak ada kasus yang memerlukan tindakan segera. ";
    t += `Tanggapan polisi atau petugas sudah terlihat di pemberitaan pada <b>${fmt(kb.tanggapan_terlihat)} kasus</b>`;
    t += kb.median_jeda_jam != null ? `, dengan median jeda <b>${fmt(kb.median_jeda_jam, 1)} jam</b> setelah berita pertama (${fmt(kb.n_jeda)} kasus yang jedanya terukur). ` : ". ";
    if (kb.melewati_batas) t += `<b>${fmt(kb.melewati_batas)} kasus</b> sudah melewati batas kabar balik statusnya tanpa tanggapan yang terlihat. `;
    const nas = (r.lonjakan_nasional || []).filter(x => x.lonjakan);
    if (nas.length) t += `Secara nasional, volume berita <b>${nas.map(x => x.nama.toLowerCase()).join(", ")}</b> kemarin melampaui 2 × rata-rata 28 hari. `;
    t += `<span class="kecil">Putaran terakhir membaca ${fmt(L.dengar.artikel)} berita; ${fmt(L.pilah.hoaks)} bertanda hoaks, ${fmt((L.pilah.bukan_kejadian || 0) + (L.pilah.luar_negeri || 0))} berita kegiatan atau luar negeri, dan ${fmt(L.pilah.tidak_relevan)} yang tidak relevan dibuang.</span>`;
    $("narasi").innerHTML = t;
  }
  function langkah() {
    const r = D.ringkasan, L = r ? r.langkah : null;
    const kol = [
      ["01", "Dengar", L ? fmt(L.dengar.artikel) : "–", "berita terbaca", L ? `dari ${L.dengar.sumber} sumber terbuka pada putaran terakhir` : "berita daring, GDELT, BMKG, MAFINDO"],
      ["02", "Pilah", L ? fmt(L.pilah.kasus_baru) : "–", "kasus baru", L ? `${fmt(L.pilah.digabung)} berita digabung ke kasus yang ada; ${fmt(L.pilah.hoaks)} hoaks dan ${fmt((L.pilah.bukan_kejadian || 0) + (L.pilah.luar_negeri || 0))} berita kegiatan atau luar negeri disaring` : "duplikat, hoaks, topik, lokasi"],
      ["03", "Timbang", r ? fmt(r.kasus_aktif) : "–", "kasus aktif", r ? URUT.map(k => `${ST[k].ikon} ${fmt(r.status[k])}`).join(" · ") : "empat status dan jalur khusus dengan ambang tertulis"],
      ["04", "Teruskan", L ? fmt(L.teruskan.polda) : "–", "Polda", L ? `${fmt(L.teruskan.kasus)} kasus diteruskan ke Polres, Polsek, Bhabinkamtibmas, atau Propam` : "penanggung jawab per wilayah"],
      ["05", "Kabarkan", L ? fmt(L.kabarkan.tanggapan_terlihat) : "–", "tanggapan terlihat", L ? (L.kabarkan.median_jeda_jam != null ? `median ${fmt(L.kabarkan.median_jeda_jam, 1)} jam setelah berita pertama; ` : "") + `${fmt(L.kabarkan.melewati_batas)} melewati batas` : "diterima, diperiksa, selesai"],
      ["06", "Arsipkan", L ? fmt(L.arsipkan.baris) : "–", "kasus terarsip", L ? `${fmt(L.arsipkan.bulan)} bulan; riwayat ${fmt(L.arsipkan.hari_riwayat)} hari untuk Pusat Sejarah Polri` : "ringkasan bulanan"],
    ];
    $("langkah").innerHTML = kol.map(k => `<div class="lk"><div class="no">LANGKAH ${k[0]}</div><h4>${k[1]}</h4>
      <div class="besar num">${k[2]} <small>${k[3]}</small></div><p>${k[4]}</p></div>`).join("");
  }
  function kartuKasus(h) {
    const lok = h.lok ? (h.lok.kab ? `${esc(h.lok.kab)}, ${esc(h.lok.prov)}` : esc(h.lok.prov)) : "Lokasi belum jelas";
    let kabar;
    if (h.tanggapan) {
      kabar = h.tanggapan.sejak_awal
        ? `<div class="kabar ok">✓ Tanggapan sudah ada sejak berita pertama (“${esc(h.tanggapan.kata)}”).</div>`
        : `<div class="kabar ok">✓ Tanggapan terlihat <b>${fmt(h.jeda_tanggapan_jam, 1)} jam</b> setelah berita pertama: “${esc(h.tanggapan.judul)}”</div>`;
    } else if (h.melewati_batas) {
      kabar = `<div class="kabar lewat">⚠ Melewati batas kabar balik (${esc(h.batas_waktu)}) tanpa tanggapan yang terlihat di pemberitaan.</div>`;
    } else kabar = `<div class="kabar">⏳ Tanggapan belum terlihat di pemberitaan.</div>`;
    const art = (h.artikel || []).map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.judul)}</a> <span class="kecil">· ${esc(a.media)} · ${lalu(a.terbit)}</span></li>`).join("");
    return `<article class="kartu kasus k-${ST[h.status].cls}">
      <div class="baris1">${lencana(h.status)}<span class="topik-chip">${esc(h.topik_nama)}</span><span class="kecil">pertama ${lalu(h.pertama)}</span></div>
      <h4>${esc(h.judul)}</h4>
      <div class="lok">📍 ${lok}${h.lok && h.lok.kode_kab ? ` <span class="kecil mono">· kode ${esc(h.lok.kode_kab)}</span>` : ""}</div>
      <dl><dt>Penanggung jawab</dt><dd>${esc(h.penanggung_jawab)}</dd>
          <dt>Batas waktu</dt><dd>${esc(h.batas_waktu)}</dd>
          <dt>Diberitakan</dt><dd>${fmt(h.n_media)} media · ${fmt(h.n_artikel)} berita</dd></dl>
      <div class="alasan">${(h.alasan || []).map(a => `<code>${esc(a)}</code>`).join("")}</div>
      ${kabar}
      <div class="kaki-kasus"><details class="artikel"><summary>Berita dalam kasus ini (${fmt(h.n_artikel)})</summary><ul>${art}</ul></details>
      <a class="lacak-tautan" href="#lacak=${esc(h.id)}">Lacak kabar →</a></div>
    </article>`;
  }
  function prioritas() {
    const k = D.kasus ? D.kasus.kasus : [];
    // yang benar-benar menunggu: belum terlihat ditanggapi; yang melewati batas didahulukan
    const tunggu = k.filter(h => ["DARURAT", "JALUR KHUSUS", "TINDAK", "PANTAU"].includes(h.status) && !h.tanggapan)
      .sort((a, b) => (URUT.indexOf(a.status) - URUT.indexOf(b.status)) || (b.n_media - a.n_media));
    // campuran: semua Darurat, sampai 3 Tindak, sampai 2 yang melewati batas, 1 jalur khusus, lalu sisanya
    let p = [];
    const ambilJ = (f, n) => tunggu.filter(h => !p.includes(h) && f(h)).slice(0, n).forEach(h => p.push(h));
    ambilJ(h => h.status === "DARURAT", 6); ambilJ(h => h.status === "TINDAK", 3); ambilJ(h => h.melewati_batas, 2);
    ambilJ(h => h.status === "JALUR KHUSUS", 1); ambilJ(() => true, 6);
    p = p.slice(0, 6);
    if (!p.length) p = k.slice(0, 4);
    $("prioritas").innerHTML = p.length ? p.map(kartuKasus).join("") : `<div class="kartu kosong">${D.kasus ? "Tidak ada kasus yang sedang menunggu tanggapan." : "Belum ada kasus. Daftar muncul setelah putaran pertama."}</div>`;
  }
  const INFO_SUMBER = {
    "Berita daring (Google News RSS)": ["Google News, cadangan Bing News", "berita terbaca"],
    "Volume berita GDELT (90 hari)": ["The GDELT Project", "topik terbaca"],
    "Gempa BMKG": ["Badan Meteorologi, Klimatologi, dan Geofisika", "berkas terbaca"],
    "Daftar hoaks TurnBackHoax (MAFINDO)": ["Masyarakat Antifitnah Indonesia", "klaim terbaru"],
  };
  function sumber() {
    const su = D.sumber ? D.sumber.sumber || {} : {};
    const nama = Object.keys(INFO_SUMBER);
    $("sumber").innerHTML = nama.map(n => {
      const s = su[n], info = INFO_SUMBER[n];
      let badge = `<span class="segar lama">belum dicek</span>`;
      if (s) badge = !s.ok ? `<span class="segar gagal">gagal</span>` : `<span class="segar${umurJam(s.dicek_utc) > 3 ? " lama" : ""}">${lalu(s.dicek_utc)}</span>`;
      return `<div class="kartu sumber"><div class="atas"><h4>${esc(n)}</h4>${badge}</div><div class="peng">${esc(info[0])}</div>
        <div class="nilai num">${s ? fmt(s.n) : "–"} <span class="kecil">${info[1]}</span></div>
        <p>${s ? esc(s.pesan) : "Menunggu putaran pertama."}</p>
        <div class="kaki">🕒 dicek ${s ? wib(s.dicek_utc, { year: undefined }) : "—"}</div></div>`;
    }).join("");
  }
  function grafikTopik() {
    const svg = $("g-topik"); if (!svg || !svg.getBoundingClientRect().width) return;
    const r = D.ringkasan;
    const item = Object.keys(TOPIK).map(k => ({ k, nama: TOPIK[k], v: r && r.topik[k] ? r.topik[k].kasus : 0 })).sort((a, b) => b.v - a.v);
    const W = Math.max(280, svg.getBoundingClientRect().width), baris = 40, H = item.length * baris, R = 40;
    const maks = Math.max(1, ...item.map(i => i.v));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let h = "";
    item.forEach((it, i) => {
      const y = i * baris, w = (W - R) * it.v / maks;
      h += `<text x="0" y="${y + 14}" font-size="12.5" fill="${css("--ink-2")}">${esc(it.nama)}</text>`;
      h += `<rect x="0" y="${y + 20}" width="${W - R}" height="12" rx="4" fill="${css("--surface-3")}"></rect>`;
      if (it.v) h += `<rect x="0" y="${y + 20}" width="${Math.max(4, w)}" height="12" rx="4" fill="${css("--biru")}"></rect>`;
      h += `<text x="${W - R + 8}" y="${y + 30}" font-size="12.5" font-weight="700" fill="${css("--ink")}" class="num">${fmt(it.v)}</text>`;
      h += `<rect x="0" y="${y}" width="${W}" height="${baris}" fill="transparent" data-i="${i}" style="cursor:pointer"></rect>`;
    });
    svg.innerHTML = h;
    svg.onpointermove = e => { const i = e.target.dataset?.i; if (i == null) return sembunyikan(); const it = item[i]; tunjuk(e, `<b>${esc(it.nama)}</b>${fmt(it.v)} kasus aktif · sentuh untuk melihat daftarnya`); };
    svg.onpointerleave = sembunyikan;
    svg.onclick = e => { const i = e.target.dataset?.i; if (i == null) return; resetSaring(); F.topik = item[i].k; isiSaring(); daftar(); peta(); buka("pantau", "paksa"); };
  }

  // ------------------------------------------------------------ pantau langsung
  // Persentase korban kejahatan yang melapor ke polisi menurut provinsi, [2023, 2024].
  // Sumber: BPS, Statistik Kriminal 2024/2025, Lampiran 49 (Susenas Maret). null = NA di publikasi.
  const BPS_LAPOR = {
    "11": [10.64, 17.59], "12": [20.19, 18.43], "13": [14.29, 22.57], "14": [15.66, 20.10], "15": [20.54, 13.24], "16": [23.53, 16.97],
    "17": [17.55, 24.42], "18": [23.07, 21.21], "19": [16.87, 16.03], "21": [13.74, 27.01], "31": [23.96, 25.48], "32": [26.60, 19.04],
    "33": [17.49, 21.73], "34": [24.91, 26.14], "35": [24.17, 21.05], "36": [34.11, 17.77], "51": [12.05, 19.21], "52": [27.12, 16.12],
    "53": [13.42, 20.70], "61": [15.07, 16.61], "62": [33.51, 21.50], "63": [26.02, 18.71], "64": [36.49, 17.74], "65": [23.45, 26.13],
    "71": [25.21, 19.21], "72": [24.88, 16.59], "73": [21.94, 27.57], "74": [17.89, 38.97], "75": [42.46, 7.91], "76": [25.27, 25.49],
    "81": [19.09, 19.25], "82": [14.55, 17.12], "91": [35.75, 25.13], "92": [56.51, 41.85], "94": [39.05, 48.60], "95": [26.74, 26.38],
    "96": [17.29, null], "97": [null, 8.15],
  };
  const BPS_NASIONAL = [23.36, 20.28];
  const TITIK_GANTI = { "21": [203.7, 115.5] };   // Kepri: titik dipindah ke sekitar Batam
  let PETA = null, modePeta = "kasus";
  const NAMA_PROV = {
    "11": "Aceh", "12": "Sumatera Utara", "13": "Sumatera Barat", "14": "Riau", "15": "Jambi", "16": "Sumatera Selatan", "17": "Bengkulu", "18": "Lampung",
    "19": "Kepulauan Bangka Belitung", "21": "Kepulauan Riau", "31": "DKI Jakarta", "32": "Jawa Barat", "33": "Jawa Tengah", "34": "DI Yogyakarta",
    "35": "Jawa Timur", "36": "Banten", "51": "Bali", "52": "Nusa Tenggara Barat", "53": "Nusa Tenggara Timur", "61": "Kalimantan Barat",
    "62": "Kalimantan Tengah", "63": "Kalimantan Selatan", "64": "Kalimantan Timur", "65": "Kalimantan Utara", "71": "Sulawesi Utara",
    "72": "Sulawesi Tengah", "73": "Sulawesi Selatan", "74": "Sulawesi Tenggara", "75": "Gorontalo", "76": "Sulawesi Barat", "81": "Maluku",
    "82": "Maluku Utara", "91": "Papua Barat", "92": "Papua Barat Daya", "94": "Papua", "95": "Papua Selatan", "96": "Papua Tengah", "97": "Papua Pegunungan",
  };
  function isiSaring() {
    const k = D.kasus ? D.kasus.kasus : [];
    const hit = {}; k.forEach(h => hit[h.status] = (hit[h.status] || 0) + 1);
    $("saring-status").innerHTML = `<button class="chip" type="button" data-s="" aria-pressed="${F.status === ""}">Semua (${fmt(k.length)})</button>` +
      URUT.map(s => `<button class="chip" type="button" data-s="${s}" aria-pressed="${F.status === s}">${ST[s].ikon} ${ST[s].nama} (${fmt(hit[s] || 0)})</button>`).join("");
    $("saring-status").querySelectorAll("[data-s]").forEach(b => b.onclick = () => { F.status = b.dataset.s; F.n = 24; isiSaring(); daftar(); });
    const tp = $("f-topik");
    if (tp.options.length < 2) Object.entries(TOPIK).forEach(([v, n]) => tp.add(new Option(n, v)));
    tp.value = F.topik;
    const pv = $("f-prov");
    const ada = {}; k.forEach(h => { if (h.lok) ada[h.lok.kode_prov] = (ada[h.lok.kode_prov] || 0) + 1; });
    pv.innerHTML = `<option value="">Semua provinsi</option>` + Object.keys(NAMA_PROV).sort((a, b) => NAMA_PROV[a].localeCompare(NAMA_PROV[b]))
      .map(c => `<option value="${c}">${NAMA_PROV[c]} (${ada[c] || 0})</option>`).join("");
    pv.value = F.prov;
  }
  $("f-topik").onchange = e => { F.topik = e.target.value; F.n = 24; daftar(); };
  $("f-prov").onchange = e => { F.prov = e.target.value; F.n = 24; daftar(); peta(); };
  $("f-urut").onchange = e => { F.urut = e.target.value; daftar(); };
  $("f-cari").oninput = e => { F.cari = e.target.value.trim().toLowerCase(); F.n = 24; daftar(); };
  $("muat-lagi").onclick = () => { F.n += 24; daftar(); };
  document.querySelectorAll("#mode-peta [data-mode]").forEach(b => b.onclick = () => {
    modePeta = b.dataset.mode;
    document.querySelectorAll("#mode-peta [data-mode]").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    peta();
  });
  function tersaring() {
    let k = D.kasus ? D.kasus.kasus.slice() : [];
    if (F.status) k = k.filter(h => h.status === F.status);
    if (F.topik) k = k.filter(h => h.topik === F.topik);
    if (F.prov) k = k.filter(h => h.lok && h.lok.kode_prov === F.prov);
    if (F.cari) k = k.filter(h => (h.judul + " " + (h.lok ? (h.lok.kab || "") + " " + h.lok.prov + " " + h.lok.polda : "") + " " + h.artikel.map(a => a.judul).join(" ")).toLowerCase().includes(F.cari));
    if (F.urut === "baru") k.sort((a, b) => b.terakhir.localeCompare(a.terakhir));
    else if (F.urut === "media") k.sort((a, b) => b.n_media - a.n_media);
    return k;
  }
  function daftar() {
    const k = tersaring();
    $("jumlah-saring").innerHTML = D.kasus ? `${fmt(k.length)} kasus cocok dengan saringan · diperbarui ${lalu(D.kasus.diperbarui_utc)}` +
      (F.prov ? ` <span class="saring-aktif">📍 ${esc(NAMA_PROV[F.prov] || F.prov)}<button type="button" id="hapus-prov" aria-label="Hapus saringan provinsi">✕</button></span>` : "") : "";
    const hp = $("hapus-prov"); if (hp) hp.onclick = () => pilihProv("");
    $("daftar").innerHTML = k.length ? k.slice(0, F.n).map(kartuKasus).join("") : `<div class="kartu kosong">Tidak ada kasus yang cocok${D.kasus ? "" : " (menunggu putaran pertama)"}.</div>`;
    $("muat-lagi").classList.toggle("sembunyi", k.length <= F.n);
  }
  async function muatPeta() {
    try { const r = await fetch("assets/peta_id.json"); if (r.ok) PETA = await r.json(); } catch (e) { /* abaikan */ }
    peta();
  }
  const fmtPersen = v => v == null ? "NA" : fmt(v, 2) + "%";
  function peta() {
    const el = $("peta"); if (!el) return;
    if (!PETA) { el.innerHTML = `<p class="kecil">Memuat peta…</p>`; return; }
    const r = D.ringkasan, prov = r ? r.provinsi || {} : {};
    const tot = c => URUT.reduce((s, k) => s + (prov[c] && prov[c][k] ? prov[c][k] : 0), 0);
    const maks = Math.max(1, ...Object.keys(PETA.prov).map(tot));
    const kelasKasus = v => v <= 0 ? 0 : Math.min(6, 1 + Math.floor(5 * Math.log(1 + v) / Math.log(1 + maks)));
    const BATAS_SENYAP = [70, 75, 80, 85, 90];
    const kelasSenyap = v => v == null ? -1 : 1 + BATAS_SENYAP.filter(b => v >= b).length;
    // rata-rata 2023–2024 karena angka provinsi berasal dari sampel kecil; satu tahun saja bisa menyesatkan
    const senyap = c => { const b = BPS_LAPOR[c], v = rata2(c) != null ? rata2(c) : (b ? (b[1] != null ? b[1] : b[0]) : null); return v == null ? null : +(100 - v).toFixed(2); };
    const warnaStatus = s => css("--" + ({ "DARURAT": "darurat", "JALUR KHUSUS": "khusus", "TINDAK": "tindak", "PANTAU": "pantau", "TERCATAT": "tercatat" }[s]) + "-tanda");
    let h = `<svg class="peta-svg" viewBox="${PETA.viewBox}" role="img" aria-label="Peta Indonesia per provinsi">
      <defs><pattern id="arsir-na" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill="${css("--surface-2")}"/><line x1="0" y1="0" x2="0" y2="5" stroke="${css("--ink-3")}" stroke-width="1.2"/></pattern></defs>`;
    Object.entries(PETA.prov).forEach(([c, p]) => {
      const kl = modePeta === "kasus" ? kelasKasus(tot(c)) : kelasSenyap(senyap(c));
      const isi = kl < 0 ? "url(#arsir-na)" : `var(--seq-${kl})`;
      h += `<path class="prov${F.prov === c ? " pilih" : ""}" d="${p.d}" fill="${isi}" data-p="${c}" aria-label="${esc(p.nama)}"></path>`;
    });
    if (modePeta === "kasus") {
      Object.entries(PETA.prov).forEach(([c, p]) => {
        const v = tot(c); if (!v) return;
        const tertinggi = URUT.find(k => prov[c] && prov[c][k]);
        const [x, y] = TITIK_GANTI[c] || [p.cx, p.cy];
        h += `<circle class="titik" cx="${x}" cy="${y}" r="${(3 + Math.sqrt(v) * 1.7).toFixed(1)}" fill="${warnaStatus(tertinggi)}" data-p="${c}"></circle>`;
      });
    }
    h += `</svg>`;
    el.innerHTML = h;
    el.querySelectorAll("[data-p]").forEach(n => {
      n.onclick = () => pilihProv(F.prov === n.dataset.p ? "" : n.dataset.p, true);
      n.onpointermove = e => {
        const c = n.dataset.p, p = prov[c] || {}, b = BPS_LAPOR[c] || [null, null];
        tunjuk(e, `<b>${esc(PETA.prov[c].nama)}</b>${r && r.provinsi[c] ? esc(r.provinsi[c].polda) : esc(NAMA_PROV[c] ? "" : "")}<br>` +
          (URUT.filter(k => p[k]).map(k => `${ST[k].ikon} ${ST[k].nama}: ${p[k]}`).join("<br>") || "tidak ada kasus aktif") +
          `<br><span class="kecil">Korban yang melapor ke polisi (BPS): ${fmtPersen(b[0])} (2023), ${fmtPersen(b[1])} (2024)${b[0] != null && b[1] != null && Math.abs(b[0] - b[1]) > 10 ? " · <b>naik-turun > 10 poin, baca hati-hati</b>" : ""}</span>`);
      };
      n.onpointerleave = sembunyikan;
    });
    $("legenda-peta").innerHTML = modePeta === "kasus"
      ? `<span>sedikit</span>${[1, 2, 3, 4, 5, 6].map(i => `<i style="background:var(--seq-${i})"></i>`).join("")}<span>banyak kasus</span>
         <span style="margin-left:14px;white-space:normal">lingkaran = jumlah kasus, warna = status tertinggi: ${URUT.map(k => `${ST[k].ikon} ${ST[k].nama}`).join(" · ")}</span>`
      : `<span>korban yang <b>tidak</b> melapor ke polisi, rata-rata 2023–2024:</span>${["< 70%", "70–75%", "75–80%", "80–85%", "85–90%", "≥ 90%"].map((t, i) => `<i style="background:var(--seq-${i + 1})"></i><span>${t}</span>`).join("")}<i style="background:repeating-linear-gradient(45deg,var(--ink-3) 0 1.5px,var(--surface-2) 1.5px 5px)"></i><span>NA (tidak tersedia)</span>`;
    panelProv();
    // panel suara senyap: hanya pada lapisan Suara senyap, supaya daftar kasus langsung di bawah peta
    $("senyap").classList.toggle("sembunyi", modePeta !== "senyap");
    const daftarSenyap = Object.keys(BPS_LAPOR).filter(c => rata2(c) != null).sort((a, b) => rata2(a) - rata2(b)).slice(0, 6);
    $("senyap").innerHTML = `<div class="kartu blok" style="box-shadow:none">
      <b>Suara senyap: provinsi yang konsisten paling jarang melapor (rata-rata BPS 2023–2024)</b>
      <div class="tabel-wadah" style="margin-top:8px"><table class="tbl"><thead><tr><th>Provinsi</th><th class="n">Melapor 2023</th><th class="n">Melapor 2024</th><th class="n">Rata-rata</th><th class="n">Kasus PEKA aktif</th></tr></thead><tbody>
      ${daftarSenyap.map(c => `<tr><td>${esc(PETA.prov[c] ? PETA.prov[c].nama : NAMA_PROV[c])}</td><td class="n">${fmtPersen(BPS_LAPOR[c][0])}</td><td class="n">${fmtPersen(BPS_LAPOR[c][1])}</td><td class="n"><b>${fmtPersen(rata2(c))}</b></td><td class="n">${fmt(tot(c))}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="kecil" style="margin:8px 0 0">Nasional: ${fmtPersen(BPS_NASIONAL[0])} (2023) dan ${fmtPersen(BPS_NASIONAL[1])} (2024) korban melapor. Dengan 0,73% penduduk menjadi korban dan 281,6 juta penduduk pada 2024, artinya <b>sekitar 1,6 juta korban tidak melapor ke polisi dalam setahun</b>; setiap kenaikan 1 poin persentase berarti sekitar 20 ribu korban lagi bersuara. Tabel memakai rata-rata dua tahun karena angka provinsi berasal dari sampel Susenas yang kecil dan dapat naik-turun tajam; Gorontalo, misalnya, 42,46% pada 2023 lalu 7,91% pada 2024. Provinsi yang konsisten senyap adalah calon lokasi uji coba PEKA: di sana keluhan yang sampai ke berita hanya puncak gunung es, sehingga kanal yang dekat dengan warga (Bhabinkamtibmas, akun resmi Polres, layanan 110) paling dibutuhkan.</p></div>`;
  }
  const rata2 = c => BPS_LAPOR[c] && BPS_LAPOR[c][0] != null && BPS_LAPOR[c][1] != null ? +((BPS_LAPOR[c][0] + BPS_LAPOR[c][1]) / 2).toFixed(2) : null;
  function pilihProv(c, dariPeta) {
    F.prov = c; F.n = 24; sembunyikan(); isiSaring(); daftar(); peta();
    // pastikan panel provinsi terlihat, terutama di layar ponsel
    if (c && dariPeta) requestAnimationFrame(() => $("prov-pilih").scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  function poldaProv(c) {
    const r = D.ringkasan && D.ringkasan.provinsi && D.ringkasan.provinsi[c];
    if (r && r.polda) return r.polda;
    const hit = Object.entries(PROV_POLDA).find(([, v]) => (v || []).includes(c));
    return hit ? hit[0] : "";
  }
  function panelProv() {
    const el = $("prov-pilih"); if (!el) return;
    const c = F.prov;
    if (!c) { el.classList.add("sembunyi"); el.innerHTML = ""; return; }
    const k = (D.kasus ? D.kasus.kasus : []).filter(h => h.lok && h.lok.kode_prov === c);
    // jumlah dari ringkasan (lengkap); daftar kasus di halaman dibatasi 400 kasus paling mendesak
    const rp = D.ringkasan && D.ringkasan.provinsi ? D.ringkasan.provinsi[c] : null;
    const hit = {}; if (rp) URUT.forEach(s2 => { if (rp[s2]) hit[s2] = rp[s2]; }); else k.forEach(h => hit[h.status] = (hit[h.status] || 0) + 1);
    const total = URUT.reduce((a, s2) => a + (hit[s2] || 0), 0);
    const polda = poldaProv(c), b = BPS_LAPOR[c] || [null, null];
    const atas = k.slice().sort((a, b2) => (URUT.indexOf(a.status) - URUT.indexOf(b2.status)) || (b2.n_media - a.n_media)).slice(0, 3);
    el.innerHTML = `<div class="atas"><h3>📍 ${esc(NAMA_PROV[c] || c)}</h3><span class="kecil">${esc(polda ? namaPolda(polda) : "")}</span></div>
      <div style="margin-top:6px;font-size:14px">${total ? `<b>${fmt(total)} kasus aktif</b>: ${URUT.filter(s => hit[s]).map(s => `${ST[s].ikon} ${fmt(hit[s])} ${ST[s].nama}`).join(" · ")}` : "Tidak ada kasus aktif dalam 72 jam terakhir."}
        <span class="kecil"> · korban yang melapor ke polisi (BPS): ${fmtPersen(b[0])} pada 2023, ${fmtPersen(b[1])} pada 2024</span></div>
      ${atas.length ? `<ul>${atas.map(h => `<li>${lencana(h.status)}<span><a href="#lacak=${esc(h.id)}">${esc(h.judul)}</a> <span class="kecil">· ${esc(h.lok.kab || "tingkat provinsi")}</span></span></li>`).join("")}</ul>` : ""}
      <div class="aksi-prov">
        ${k.length ? `<button type="button" class="chip utama-chip" id="ke-daftar">Lihat kasusnya di daftar ↓</button>` : ""}
        ${polda ? `<button type="button" class="chip" id="ke-polda">Ringkasan pagi ${esc(namaPolda(polda))} →</button>` : ""}
        <button type="button" class="chip" id="hapus-prov2">✕ Hapus saringan</button>
      </div>`;
    el.classList.remove("sembunyi");
    const kd = $("ke-daftar"); if (kd) kd.onclick = () => { const t = $("judul-daftar").getBoundingClientRect().top + scrollY - 72; scrollTo({ top: t, behavior: "smooth" }); };
    const kp = $("ke-polda"); if (kp) kp.onclick = () => { poldaPilih = polda; simpan("peka-polda", polda); isiPolda(); lembar(); papan(); buka("polda", "paksa"); };
    $("hapus-prov2").onclick = () => pilihProv("");
  }

  // ------------------------------------------------------------ per Polda
  let poldaPilih = baca("peka-polda") || "";
  const URUT_PERLU = ["DARURAT", "JALUR KHUSUS", "TINDAK", "PANTAU"];
  const PROV_POLDA = {};   // Polda -> [kode provinsi], dari polda.json
  function kasusPolda(p) { return (D.kasus ? D.kasus.kasus : []).filter(h => h.lok && h.lok.polda === p); }
  function perluPolda(p) {
    return kasusPolda(p).filter(h => URUT_PERLU.includes(h.status) && !h.tanggapan)
      .sort((a, b) => (URUT.indexOf(a.status) - URUT.indexOf(b.status)) || ((b.melewati_batas ? 1 : 0) - (a.melewati_batas ? 1 : 0)) || a.pertama.localeCompare(b.pertama));
  }
  const namaPolda = p => p.replace("Polda yang membawahi ", "Polda (wilayah) ");
  function isiPolda() {
    const sel = $("f-polda"); if (!sel) return;
    const papanP = D.polda ? D.polda.polda : [];
    papanP.forEach(r => { PROV_POLDA[r.polda] = r.provinsi; });
    const semua = papanP.length ? papanP.map(r => r.polda) : [...new Set((D.kasus ? D.kasus.kasus : []).filter(h => h.lok).map(h => h.lok.polda))];
    const nPerlu = {}; semua.forEach(p => nPerlu[p] = perluPolda(p).length);
    if (!poldaPilih || !semua.includes(poldaPilih)) poldaPilih = semua.slice().sort((a, b) => nPerlu[b] - nPerlu[a] || a.localeCompare(b))[0] || "";
    sel.innerHTML = semua.slice().sort((a, b) => a.localeCompare(b)).map(p => `<option value="${esc(p)}">${esc(namaPolda(p))} · ${fmt(nPerlu[p])} menunggu tanggapan</option>`).join("");
    sel.value = poldaPilih;
  }
  $("f-polda").onchange = e => { poldaPilih = e.target.value; simpan("peka-polda", poldaPilih); lembar(); papan(); };
  // Cermin sejarah untuk apel pagi: satu pelajaran dari Bab IV naskah (Tabel 4.1), dipilih menurut topik kasus yang menunggu.
  const CERMIN = {
    anggota: ["Sum Kuning, Yogyakarta, 1970", "Korban yang melapor justru dijadikan tersangka dan diadili. Hakim membebaskannya, dan Kapolri Hoegeng Iman Santoso membentuk tim pemeriksa. Pelajarannya: keluhan tentang anggota tidak boleh diperiksa oleh satuan yang dikeluhkan."],
    perempuan_anak: ["Luwu Timur, 2019–2021", "Dua tahun aduan melalui jalur resmi, termasuk dua kali gelar perkara, tidak membuka kembali penyelidikan dugaan kekerasan seksual terhadap anak. Penyelidikan baru dibuka setelah tagar #PercumaLaporPolisi ramai pada Oktober 2021."],
    jalanan: ["Pulogadung, Jakarta Timur, 2021", "Laporan perampokan ditolak petugas pada 7 Desember. Tiga hari kemudian kasusnya viral, dan dua hari setelah itu polisi bertindak. Laporan yang ditolak hari ini bisa menjadi berita besar besok."],
    layanan: ["Layanan 110, 2013", "Saluran darurat baru dibanjiri panggilan kosong atau iseng. Saluran perlu dipilah agar keluhan sungguhan tidak tenggelam."],
    bawaan: ["Proklamasi Polisi, Surabaya, 21 Agustus 1945", "Polisi menyatakan diri bersatu dengan rakyat. Mendengar keluhan warga adalah cara paling sehari-hari untuk menepati janji itu."],
  };
  function cerminSejarah(perlu, aktif) {
    const n = {}; (perlu.length ? perlu : aktif).forEach(h => { n[h.topik] = (n[h.topik] || 0) + 1; });
    const urut = Object.keys(n).sort((a, b) => n[b] - n[a]);
    const tp = perlu.some(h => h.topik === "anggota") ? "anggota" : (urut.find(t => CERMIN[t]) || "bawaan");
    const c = CERMIN[tp];
    return `<section class="cermin"><span class="lembar-label">CERMIN SEJARAH UNTUK APEL HARI INI</span><p><b>${esc(c[0])}.</b> ${esc(c[1])}</p></section>`;
  }
  function lembar() {
    const el = $("lembar"); if (!el) return;
    if (!D.kasus || !poldaPilih) { el.innerHTML = `<div class="kosong">Ringkasan pagi muncul setelah putaran pertama.</div>`; return; }
    const p = poldaPilih, aktif = kasusPolda(p), perlu = perluPolda(p);
    const lewat = aktif.filter(h => h.melewati_batas).length, tg = aktif.filter(h => h.tanggapan).length;
    const baris = D.polda ? D.polda.polda.find(r => r.polda === p) : null;
    const prov = (PROV_POLDA[p] || [...new Set(aktif.map(h => h.lok.kode_prov))]);
    const waktu = D.ringkasan ? wib(D.ringkasan.diperbarui_utc) : wib(D.kasus.diperbarui_utc);
    const kpi = [[fmt(aktif.length), "kasus aktif", "berita terakhir ≤ 72 jam"], [fmt(perlu.length), "menunggu tanggapan", "Darurat, Jalur khusus, Tindak, atau Pantau yang tanggapannya belum terlihat"],
      [fmt(lewat), "melewati batas", "tanpa tanggapan yang terlihat"], [fmt(tg), "sudah terlihat ditanggapi", "tanggapan muncul di berita"]];
    const N = 10;
    const tabel = perlu.length ? `<div class="tabel-wadah"><table class="tbl lembar-tbl"><thead><tr><th>Status</th><th>Kab/kota</th><th>Kejadian</th><th>Penanggung jawab</th><th>Batas waktu</th></tr></thead><tbody>${perlu.slice(0, N).map(h => {
      const pj = h.penanggung_jawab.replace(/\s*\(Polda[^)]*\)$/, "");
      return `<tr><td data-l="Status">${lencana(h.status)}</td><td data-l="Kab/kota">${esc(h.lok.kab ? h.lok.kab.replace(/^Kabupaten /, "Kab. ") : "(provinsi)")}</td>
        <td data-l="Kejadian"><a href="#lacak=${esc(h.id)}">${esc(h.judul.length > 120 ? h.judul.slice(0, 117) + "…" : h.judul)}</a><div class="kecil">pertama ${lalu(h.pertama)} · ${fmt(h.n_media)} media</div></td>
        <td data-l="Penanggung jawab">${esc(pj)}</td><td data-l="Batas waktu">${h.melewati_batas ? `<b class="merah">⚠ lewat</b><div class="kecil">${esc(h.batas_waktu)}</div>` : esc(h.batas_waktu)}</td></tr>`;
    }).join("")}</tbody></table></div>${perlu.length > N ? `<p class="kecil" style="margin:6px 0 0">dan ${fmt(perlu.length - N)} kasus lain; daftar lengkap di tab Pantau Langsung.</p>` : ""}`
      : `<p style="margin:0">Tidak ada kasus yang perlu ditindaklanjuti dalam 72 jam terakhir.</p>`;
    const sejak = D.polda && D.polda.arsip_sejak_utc ? new Date(D.polda.arsip_sejak_utc) : null;
    const kurun = sejak && (Date.now() - sejak) < 30 * 864e5 ? `sejak arsip dimulai ${wib(D.polda.arsip_sejak_utc, { hour: undefined, minute: undefined }).replace(" WIB", "")}` : "30 hari terakhir";
    const kb = baris && baris.perlu ? `Dari <b>${fmt(baris.perlu)}</b> kasus yang sempat perlu ditindaklanjuti (${kurun}), tanggapan terlihat pada <b>${fmt(baris.perlu_tanggap)}</b> kasus (${fmt(baris.persen_tanggap, 0)}%)${baris.median_jeda_jam != null ? `, median jeda <b>${fmt(baris.median_jeda_jam, 1)} jam</b>` : ""}. ${fmt(baris.melewati_batas)} melewati batas; ${fmt(baris.jalur_khusus)} masuk jalur khusus ke Propam.`
      : `Belum ada kasus perlu tindak lanjut di arsip (${kurun}).`;
    const sn = prov.filter(c => BPS_LAPOR[c]).map(c => {
      const b = BPS_LAPOR[c], r2 = rata2(c), nas = (BPS_NASIONAL[0] + BPS_NASIONAL[1]) / 2;
      return `<b>${esc(NAMA_PROV[c])}</b>: korban yang melapor ke polisi ${fmtPersen(b[0])} (2023) dan ${fmtPersen(b[1])} (2024); nasional ${fmtPersen(BPS_NASIONAL[1])} (2024).${r2 != null && r2 < nas ? " Rata-rata dua tahunnya di bawah nasional: perkuat kanal yang dekat dengan warga." : ""}`;
    }).join("<br>") || "—";
    const rw = D.polda ? (D.polda.titik_rawan || []).filter(t => t.polda === p) : [];
    const ar = D.polda ? D.polda.aturan_rawan : null;
    const rawanHtml = rw.length ? `<ul class="rapat">${rw.slice(0, 3).map(t => `<li><b>${esc(t.kabkota)}</b> · ${esc(t.nama)}: ${fmt(t.kejadian)} kejadian (${t.tanggal.map(d => tglPendek(d)).join(", ")}) → ${esc(t.penanggung_jawab)}</li>`).join("")}</ul>${rw.length > 3 ? `<p class="kecil" style="margin:4px 0 0">dan ${fmt(rw.length - 3)} titik rawan lain di tab Per Polda.</p>` : ""}`
      : `<p style="margin:0">Belum ada. Aturan: ≥ ${ar ? ar.min_kejadian : 3} kejadian terpisah pada topik yang sama di satu kab/kota dalam ${ar ? ar.jendela_hari : 30} hari.</p>`;
    const qr = qrSvg(SITUS + "#polda=" + encodeURIComponent(p));
    el.innerHTML = `<header class="lembar-kepala">
        <div><div class="lembar-label">RINGKASAN PAGI · PEKA</div><h3>${esc(namaPolda(p))}</h3>
          <div class="kecil">${p === "Polda Metro Jaya" ? "DKI Jakarta, Kota dan Kabupaten Bekasi, Depok, Kota Tangerang, Tangerang Selatan" : prov.map(c => esc(NAMA_PROV[c] || c)).join(", ")} · data putaran ${waktu}</div></div>
        ${qr ? `<div class="lembar-qr">${qr}<span>versi terbaru</span></div>` : ""}
      </header>
      <div class="lembar-kpi">${kpi.map(k => `<div><div class="num besar">${k[0]}</div><b>${k[1]}</b><div class="kecil">${k[2]}</div></div>`).join("")}</div>
      <h4>Perlu ditindaklanjuti hari ini</h4>${tabel}
      <div class="lembar-dua">
        <section><h4>Kabar balik</h4><p>${kb}</p></section>
        <section><h4>Suara senyap (BPS)</h4><p>${sn}</p></section>
      </div>
      <section><h4>Titik rawan berulang</h4>${rawanHtml}</section>
      ${cerminSejarah(perlu, aktif)}
      <footer class="lembar-kaki">Disusun otomatis oleh purwarupa PEKA dari judul berita publik; setiap kasus perlu diverifikasi petugas sebelum ditindak. Indikatif, bukan penilaian kinerja. Bukan kanal resmi Polri. ${esc(SITUS)}</footer>`;
  }
  function papan() {
    const el = $("tabel-papan"); if (!el) return;
    const P = D.polda ? D.polda.polda.filter(r => r.kasus) : [];
    if (!P.length) { el.innerHTML = `<tbody><tr><td class="kosong">Papan terisi setelah pipeline versi ini berjalan sekali (berkas data/polda.json belum ada atau belum berisi kasus).</td></tr></tbody>`; $("papan-ket").textContent = ""; return; }
    el.innerHTML = `<thead><tr><th>Polda</th><th class="n">Kasus</th><th class="n">Sempat perlu tindak lanjut</th><th>Tanggapan terlihat</th><th class="n">Median jeda</th><th class="n">Melewati batas</th><th class="n">Jalur khusus</th><th class="n">Korban melapor, BPS 2024</th></tr></thead><tbody>` +
      P.map(r => {
        const pc = r.persen_tanggap, bps = r.provinsi.map(c => BPS_LAPOR[c] ? BPS_LAPOR[c][1] : null).filter(v => v != null);
        return `<tr class="baris-polda${r.polda === poldaPilih ? " pilih" : ""}" data-polda="${esc(r.polda)}" tabindex="0">
          <td>${esc(namaPolda(r.polda))}</td><td class="n">${fmt(r.kasus)}</td><td class="n">${fmt(r.perlu)}</td>
          <td>${r.perlu ? `<div class="batang-pc"><span style="width:${pc || 0}%"></span></div><span class="num kecil">${fmt(r.perlu_tanggap)} dari ${fmt(r.perlu)} · <b>${fmt(pc, 0)}%</b></span>` : `<span class="kecil">—</span>`}</td>
          <td class="n">${r.median_jeda_jam != null ? fmt(r.median_jeda_jam, 1) + " jam" : "—"}</td>
          <td class="n">${r.melewati_batas ? `<b class="merah">${fmt(r.melewati_batas)}</b>` : "0"}</td><td class="n">${fmt(r.jalur_khusus)}</td>
          <td class="n">${bps.length ? bps.map(v => fmtPersen(v)).join(" / ") : "NA"}</td></tr>`;
      }).join("") + "</tbody>";
    const tot = P.reduce((s, r) => s + r.perlu, 0), tt = P.reduce((s, r) => s + r.perlu_tanggap, 0);
    const kosong = D.polda.polda.length - P.length;
    $("papan-ket").innerHTML = `Seluruh Polda: tanggapan terlihat pada ${fmt(tt)} dari ${fmt(tot)} kasus yang sempat perlu ditindaklanjuti (${fmt(tot ? 100 * tt / tot : null, 0)}%). ${fmt(kosong)} Polda lain belum memiliki kasus di arsip; ${fmt(D.polda.kasus_tanpa_polda)} kasus belum dapat dipetakan ke Polda karena judul beritanya tidak menyebut tempat. Diperbarui ${lalu(D.polda.diperbarui_utc)}.`;
    el.querySelectorAll("[data-polda]").forEach(tr => {
      const pilih = () => { poldaPilih = tr.dataset.polda; simpan("peka-polda", poldaPilih); isiPolda(); lembar(); papan(); $("lembar").scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.onclick = pilih; tr.onkeydown = e => { if (e.key === "Enter") pilih(); };
    });
  }
  function titikRawan() {
    const el = $("titik-rawan"); if (!el) return;
    const P = D.polda;
    if (!P) { el.innerHTML = `<div class="kartu blok kecil">Menunggu putaran pertama.</div>`; return; }
    const rw = P.titik_rawan || [], ar = P.aturan_rawan || { min_kejadian: 3, jendela_hari: 30, sela_jam: 72 };
    if (!rw.length) {
      const hari = P.arsip_sejak_utc ? Math.max(0, Math.floor((new Date(P.diperbarui_utc) - new Date(P.arsip_sejak_utc)) / 864e5)) : 0;
      el.innerHTML = `<div class="kartu blok"><b>Belum ada titik rawan berulang.</b> Arsip baru mencakup sekitar <b>${fmt(hari)} hari</b> berita. Aturan ini menyala sendiri ketika satu kab/kota mencatat ≥ ${ar.min_kejadian} kejadian terpisah (berselang ≥ ${ar.sela_jam} jam) pada topik yang sama dalam ${ar.jendela_hari} hari; biasanya setelah arsip berjalan beberapa minggu.</div>`;
      return;
    }
    el.innerHTML = `<div class="kartu tabel-wadah"><table class="tbl"><thead><tr><th>Kab/kota</th><th>Polda</th><th>Topik</th><th class="n">Kejadian</th><th>Tanggal kejadian</th><th class="n">Ditanggapi</th><th>Diteruskan ke</th></tr></thead><tbody>` +
      rw.map(t => `<tr><td><b>${esc(t.kabkota)}</b><div class="kecil">${esc(t.provinsi)}</div></td><td>${esc(namaPolda(t.polda || ""))}</td><td>${esc(t.nama)}</td><td class="n">${fmt(t.kejadian)}</td><td>${t.tanggal.map(d => tglPendek(d)).join(", ")}</td><td class="n">${fmt(t.kejadian_ditanggapi)} dari ${fmt(t.kejadian)}</td><td>${esc(t.penanggung_jawab)}</td></tr>`).join("") + "</tbody></table></div>";
  }
  $("cetak").onclick = () => { document.body.classList.add("cetak-polda"); window.print(); };
  let temaSebelum = null;
  addEventListener("beforeprint", () => { temaSebelum = document.documentElement.dataset.theme || null; document.documentElement.dataset.theme = "light"; });
  addEventListener("afterprint", () => {
    document.body.classList.remove("cetak-polda");
    if (temaSebelum) document.documentElement.dataset.theme = temaSebelum; else delete document.documentElement.dataset.theme;
  });

  // ------------------------------------------------------------ lacak kabar
  let ARSIP_ID = null, arsipDimuat = false, SNAP_KASUS = null;
  async function muatArsipId() {
    arsipDimuat = true;
    try {
      const r = await fetch(DATA_DIR + "arsip_kasus.csv?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const baris = (await r.text()).trim().split(/\r?\n/), kol = baris[0].split(",");
      ARSIP_ID = {};
      baris.slice(1).forEach(b => { const v = b.split(","); const o = {}; kol.forEach((k, i) => o[k] = v[i] || ""); ARSIP_ID[o.id] = o; });
    } catch (e) { /* abaikan */ }
  }
  function bukaLacak(id) {
    const dlg = $("lacak");
    if (!D.kasus) { lacakTunda = id; return; }
    let h = D.kasus.kasus.find(x => x.id === id), dariUji = false;
    if (!h && SNAP_KASUS) { h = SNAP_KASUS.find(x => x.id === id); dariUji = !!h; }
    const url = SITUS + "#lacak=" + encodeURIComponent(id);
    let isi;
    if (!h) {
      const r = ARSIP_ID ? ARSIP_ID[id] : null;
      if (!ARSIP_ID && !arsipDimuat) { muatArsipId().then(() => bukaLacak(id)); return; }
      if (!r && SNAP_KASUS === null) { ambil("kasus_terkini.json", SNAPSHOT).then(j => { SNAP_KASUS = j ? j.kasus : []; bukaLacak(id); }); return; }
      isi = `<div class="lacak-kepala"><span class="lacak-label">LACAK KABAR · ${esc(id)}</span><button type="button" class="tutup" aria-label="Tutup">✕</button></div>` + (r
        ? `<h3 id="lacak-judul">Kasus sudah keluar dari jendela 72 jam</h3>
           <ol class="linimasa">
             <li class="selesai"><b>Diterima</b><div>Berita pertama ${wib(r.pertama_utc)}; ${fmt(+r.n_media)} media.</div></li>
             <li class="selesai"><b>Ditimbang</b><div>Status awal ${ST[r.status_awal || r.status] ? lencana(r.status_awal || r.status) : esc(r.status_awal || r.status)}, status akhir ${ST[r.status] ? lencana(r.status) : esc(r.status)} · ${esc(TOPIK[r.topik] || r.topik)}</div></li>
             <li class="selesai"><b>Diteruskan</b><div>${esc(r.kabkota || r.provinsi || "lokasi belum jelas")}${r.polda ? " · " + esc(r.polda) : ""}${r.polres ? " · " + esc(r.polres) : ""}</div></li>
             <li class="${+r.tanggapan_terlihat ? "selesai" : (+r.melewati_batas ? "lewat" : "kini")}"><b>Tanggapan</b><div>${+r.tanggapan_terlihat ? (r.jeda_tanggapan_jam ? `Terlihat ${fmt(+r.jeda_tanggapan_jam, 1)} jam setelah berita pertama.` : "Terlihat sejak berita pertama.") : (+r.melewati_batas ? "Melewati batas tanpa tanggapan yang terlihat." : "Tidak terlihat di pemberitaan selama kasus aktif.")}</div></li>
             <li class="selesai"><b>Diarsipkan</b><div>Ringkasan ini dibaca dari arsip suara publik, tanpa judul dan tanpa nama.${r.koreksi ? ` <b>Dikoreksi:</b> ${esc(r.koreksi)}; baris tetap disimpan tetapi tidak ikut dihitung.` : ""}</div></li>
           </ol>`
        : `<h3 id="lacak-judul">Kasus tidak ditemukan</h3><p>Kode ini tidak ada pada data purwarupa saat ini maupun pada data uji yang dibekukan untuk naskah.</p>`);
    } else {
      const sAwal = h.status_awal || h.status, tutup = sAwal !== h.status;
      const jam = BATAS_JAM[sAwal], tenggat = jam ? new Date(new Date(h.pertama).getTime() + jam * 3.6e6).toISOString() : null;
      const pjAwal = h.penanggung_jawab_awal || h.penanggung_jawab, batasAwal = h.batas_awal || h.batas_waktu;
      const lok = h.lok ? (h.lok.kab ? `${h.lok.kab}, ${h.lok.prov}` : h.lok.prov) : "Lokasi belum jelas";
      const tg = h.tanggapan;
      const langkahL = [
        ["selesai", "Diterima", `Keluhan terdengar ${wib(h.pertama)} dari ${fmt(h.n_media)} media (${fmt(h.n_artikel)} berita).`],
        ["selesai", "Ditimbang", `${lencana(h.status)} <span class="alasan" style="display:inline-flex">${(h.alasan || []).map(a => `<code>${esc(a)}</code>`).join("")}</span>`],
        ["selesai", "Diteruskan untuk diperiksa", `${tutup ? `Sebagai kasus ${ST[sAwal].nama}: ` : ""}${esc(pjAwal)}.<br><span class="kecil">Batas: ${esc(batasAwal)}${tenggat ? ` · tenggat ${wib(tenggat)}` : ""}</span>`],
        tg ? ["selesai", "Tanggapan terlihat", tg.sejak_awal ? `Tanggapan sudah ada sejak berita pertama (“${esc(tg.kata)}”).` : `${wib(tg.terbit)}, <b>${fmt(h.jeda_tanggapan_jam, 1)} jam</b> setelah berita pertama · ${esc(tg.media)}: “${esc(tg.judul)}”`]
          : [h.melewati_batas ? "lewat" : "kini", "Tanggapan", h.melewati_batas ? `⚠ Melewati batas tanpa tanggapan yang terlihat. Pada sistem di Polri, kasus ini otomatis naik ke atasan penanggung jawab.` : `⏳ Belum terlihat. Halaman ini berubah sendiri begitu tanggapan muncul.`],
        ["selesai", tutup ? "Ditutup dan diarsipkan" : "Diarsipkan", (tutup ? "Karena tanggapan sudah terlihat, kasus keluar dari daftar tindak lanjut dan masuk rekap. " : "") + "Ringkasan tanpa judul dan tanpa nama tersimpan di Arsip Suara Publik untuk Pusat Sejarah Polri."],
      ];
      const qr = qrSvg(url);
      isi = `<div class="lacak-kepala"><span class="lacak-label">LACAK KABAR · ${esc(h.id)}</span><button type="button" class="tutup" aria-label="Tutup">✕</button></div>
        <h3 id="lacak-judul">${esc(h.judul)}</h3>
        <div class="kecil">📍 ${esc(lok)} · ${esc(h.topik_nama)}</div>
        <ol class="linimasa">${langkahL.map(l => `<li class="${l[0]}"><b>${l[1]}</b><div>${l[2]}</div></li>`).join("")}</ol>
        <div class="contoh-surat">${qr ? `<div class="qr">${qr}</div>` : ""}
          <div><b>Contoh kode pada surat</b><p>Pada sistem yang dipasang di Polri, kode seperti ini dicetak pada surat tanda terima laporan, SP2HP, dan SP3D. Warga cukup memindainya untuk melihat halaman ini: status, penanggung jawab, dan tenggat, tanpa identitas siapa pun dan tanpa harus datang ke kantor polisi.</p><span class="mono kecil">${esc(url)}</span></div></div>
        <p class="kecil" style="margin:10px 0 0">Purwarupa: langkah di atas dibaca dari berita publik, bukan dari laporan polisi.${dariUji ? " Kasus ini diambil dari data uji yang dibekukan untuk naskah (folder uji-naskah di repositori)." : ""}</p>`;
    }
    $("lacak-isi").innerHTML = isi;
    $("lacak-isi").querySelector(".tutup").onclick = () => dlg.close();
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } document.body.style.overflow = "hidden"; }
  }
  $("lacak").addEventListener("close", () => { document.body.style.overflow = ""; if (location.hash.startsWith("#lacak=")) history.replaceState(null, "", "#" + tabAktif); });
  $("lacak").addEventListener("click", e => { if (e.target === $("lacak")) $("lacak").close(); });

  // ------------------------------------------------------------ tren
  function lonjakanWilayah() {
    const r = D.ringkasan, el = $("lonjakan-wilayah");
    if (!r) { el.innerHTML = `<p class="kecil">Menunggu putaran pertama.</p>`; return; }
    const L = r.lonjakan_wilayah || [];
    let h = "";
    if ((r.hari_riwayat || 0) < 7) {
      h += `<p style="margin:0 0 8px">Riwayat arsip baru <b>${fmt(r.hari_riwayat)} dari 28 hari</b>. Sesuai Subbab 4.3.3 naskah, ambang lonjakan harus diuji pada data riwayat sebelum dipakai, jadi aturan ini baru dinyalakan setelah riwayat mencapai 7 hari. Sementara itu, pembanding nasional di bawah memakai deret GDELT 90 hari.</p>`;
    }
    if (L.length) {
      h += `<div class="tabel-wadah"><table class="tbl"><thead><tr><th>Provinsi</th><th>Topik</th><th class="n">Kasus 24 jam</th><th class="n">Rata-rata 28 hari</th></tr></thead><tbody>` +
        L.map(x => `<tr><td>${esc(x.prov)}</td><td>${esc(x.nama)}</td><td class="n">${fmt(x.hari_ini)}</td><td class="n">${fmt(x.rata, 1)}</td></tr>`).join("") + `</tbody></table></div>`;
    } else if ((r.hari_riwayat || 0) >= 7) h += `<p style="margin:0">Tidak ada provinsi dan topik yang melampaui ambang lonjakan pada 24 jam terakhir.</p>`;
    el.innerHTML = h;
  }
  function multi() {
    const g = D.gdelt, r = D.ringkasan;
    const nas = {}; (r ? r.lonjakan_nasional : []).forEach(x => nas[x.topik] = x);
    $("multi").innerHTML = Object.keys(TOPIK).map(k => {
      const n = nas[k];
      const lj = n && n.lonjakan;
      return `<button type="button" class="kartu mini" data-t="${k}" aria-pressed="${k === topikTren}">
        <div class="atas"><h4>${esc(TOPIK[k])}</h4>${lj ? `<span class="lencana s-TINDAK">▲ lonjakan</span>` : `<span class="rasio">${n && n.rasio != null ? fmt(n.rasio, 2) + "×" : ""}</span>`}</div>
        <svg class="grafik" data-spark="${k}" height="56" role="img" aria-label="Tren ${esc(TOPIK[k])}"></svg>
        <div class="kecil">${n ? `kemarin ${fmt(n.kemarin)} · rata-rata 28 hari ${fmt(n.rata28, 1)}` : (g ? "deret belum lengkap" : "menunggu data")}</div></button>`;
    }).join("");
    $("multi").querySelectorAll("[data-t]").forEach(b => b.onclick = () => { topikTren = b.dataset.t; multi(); grafikMulti(); grafikTren(); });
  }
  function rata28(a) {
    return a.map((v, i) => { const s = a.slice(Math.max(0, i - 28), i); return s.length >= 7 ? s.reduce((x, y) => x + y, 0) / s.length : null; });
  }
  function grafikMulti() {
    const g = D.gdelt;
    document.querySelectorAll("[data-spark]").forEach(svg => {
      const W = svg.getBoundingClientRect().width; if (!W) return;
      const H = 56, k = svg.dataset.spark, s = g && g.topik[k] ? g.topik[k].artikel : null;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      if (!s || !s.length) { svg.innerHTML = ""; return; }
      const m = Math.max(1, ...s), X = i => 2 + i * (W - 4) / (s.length - 1), Y = v => H - 4 - (H - 10) * v / m;
      const rr = rata28(s);
      const d = s.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
      const d2 = rr.map((v, i) => v == null ? "" : ((i && rr[i - 1] != null) ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
      svg.innerHTML = `<path d="${d2}" fill="none" stroke="${css("--ink-3")}" stroke-dasharray="3 3" stroke-width="1.2"/>
        <path d="${d}" fill="none" stroke="${css("--biru")}" stroke-width="1.6"/>
        <circle cx="${X(s.length - 2)}" cy="${Y(s[s.length - 2])}" r="3" fill="${css("--biru")}"/>`;
    });
  }
  function grafikTren() {
    const svg = $("g-tren"); if (!svg || !svg.getBoundingClientRect().width) return;
    const g = D.gdelt, k = topikTren;
    $("tren-judul").textContent = TOPIK[k];
    const W = svg.getBoundingClientRect().width, H = 300, L = 46, R = 16, T = 14, B = 30;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!g || !g.topik[k]) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${css("--ink-3")}" font-size="13">Deret GDELT belum tersedia.</text>`; $("tren-ket").textContent = ""; return; }
    const s = g.topik[k].artikel, hari = g.hari, rr = rata28(s);
    $("tren-ket").textContent = `GDELT, artikel berbahasa Indonesia per hari · ${hari[0]} sampai ${hari[hari.length - 1]} · hari terakhir belum lengkap`;
    const m = Math.max(1, ...s, ...rr.filter(v => v != null).map(v => v * 2));
    const yMax = niceMax(m), X = i => L + i * (W - L - R) / (s.length - 1), Y = v => T + (H - T - B) * (1 - v / yMax);
    let h = "";
    ticks(yMax).forEach(v => { h += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--border")}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${css("--ink-3")}" class="num">${fmt(v)}</text>`; });
    const langkahX = Math.ceil(s.length / Math.max(3, Math.floor((W - L) / 90)));
    hari.forEach((d, i) => { if (i % langkahX === 0) h += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${css("--ink-3")}">${tglPendek(d)}</text>`; });
    const pth = (arr, f) => arr.map((v, i) => v == null ? "" : ((i && arr[i - 1] != null) ? "L" : "M") + X(i).toFixed(1) + " " + Y(f(v)).toFixed(1)).join(" ");
    h += `<path d="${pth(rr, v => v * 2)}" fill="none" stroke="${css("--tindak-tanda")}" stroke-dasharray="1.5 4" stroke-linecap="round" stroke-width="2"/>`;
    h += `<path d="${pth(rr, v => v)}" fill="none" stroke="${css("--ink-3")}" stroke-dasharray="5 4" stroke-width="1.5"/>`;
    h += `<path d="${pth(s, v => v)}" fill="none" stroke="${css("--biru")}" stroke-width="2"/>`;
    s.forEach((v, i) => { if (rr[i] != null && v >= 2 * rr[i] && v >= 5) h += `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="${css("--tindak-tanda")}" stroke="${css("--surface")}" stroke-width="2"/>`; });
    h += `<line id="silang" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="${css("--ink-3")}" stroke-width="1" visibility="hidden"/><circle id="titik" r="4" fill="${css("--biru")}" stroke="${css("--surface")}" stroke-width="2" visibility="hidden"/>`;
    h += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="area-tren"/>`;
    svg.innerHTML = h;
    const area = svg.querySelector("#area-tren"), garis = svg.querySelector("#silang"), titik = svg.querySelector("#titik");
    area.onpointermove = e => {
      const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width;
      const i = Math.max(0, Math.min(s.length - 1, Math.round((x - L) / ((W - L - R) / (s.length - 1)))));
      garis.setAttribute("x1", X(i)); garis.setAttribute("x2", X(i)); garis.setAttribute("visibility", "visible");
      titik.setAttribute("cx", X(i)); titik.setAttribute("cy", Y(s[i])); titik.setAttribute("visibility", "visible");
      tunjuk(e, `<b>${tglPanjang(hari[i])}</b>${fmt(s[i])} artikel<br>rata-rata 28 hari: ${rr[i] != null ? fmt(rr[i], 1) : "—"}${rr[i] != null && s[i] >= 2 * rr[i] && s[i] >= 5 ? "<br><b>melampaui ambang 2×</b>" : ""}`);
    };
    area.onpointerleave = () => { garis.setAttribute("visibility", "hidden"); titik.setAttribute("visibility", "hidden"); sembunyikan(); };
  }
  const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const BLN_P = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const tglPendek = d => `${+d.slice(8, 10)} ${BLN[+d.slice(5, 7) - 1]}`;
  const tglPanjang = d => `${+d.slice(8, 10)} ${BLN_P[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  function niceMax(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= m) return f * p; return 10 * p; }
  function ticks(mx) { const n = 4; return Array.from({ length: n + 1 }, (_, i) => +(mx * i / n).toFixed(mx < 10 ? 1 : 0)); }
  function gempa() {
    const b = D.bmkg, el = $("gempa");
    if (!b || !b.terbaru) { el.innerHTML = `<div class="kartu blok kecil">Data gempa belum tersedia.</div>`; return; }
    const g = b.terbaru, darurat = D.ringkasan && (D.ringkasan.gempa_darurat || []).length;
    const daftarG = (b.dirasakan || []).slice(0, 5);
    el.innerHTML = `<div class="kartu blok">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap"><div class="besar" style="font:800 30px var(--font-judul)">M ${fmt(g.magnitudo, 1)}</div>
      ${darurat && D.ringkasan.status["DARURAT"] ? lencana("DARURAT") : `<span class="segar">${lalu(g.waktu_utc)}</span>`}</div>
      ${darurat ? `<p class="kecil" style="margin:6px 0 0">Gempa signifikan dalam 24 jam: kasus bencana di provinsi yang sama otomatis naik menjadi Darurat${D.ringkasan.status["DARURAT"] ? "." : " (saat ini belum ada kasus bencana di provinsi itu)."}</p>` : ""}
      <p style="margin:6px 0 4px">${esc(g.wilayah)}</p>
      <p class="kecil" style="margin:0">${wib(g.waktu_utc)} · kedalaman ${esc(g.kedalaman)} · ${esc(g.potensi || "")}${g.dirasakan ? " · dirasakan: " + esc(g.dirasakan) : ""}</p>
      ${daftarG.length ? `<div class="tabel-wadah" style="margin-top:12px"><table class="tbl"><thead><tr><th>Waktu</th><th class="n">M</th><th>Wilayah</th></tr></thead><tbody>${daftarG.map(x => `<tr><td>${wib(x.waktu_utc, { year: undefined })}</td><td class="n">${fmt(x.magnitudo, 1)}</td><td>${esc(x.wilayah)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="kecil" style="margin:10px 0 0">Sumber: BMKG.</p></div>`;
  }
  function hoaks() {
    const h = D.ringkasan ? D.ringkasan.hoaks_terbaru || [] : [];
    $("hoaks").innerHTML = h.length ? `<ul style="margin:0;padding-left:18px">${h.map(x => `<li style="margin:4px 0"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.judul)}</a> ${x.terbit ? `<span class="kecil">· ${lalu(x.terbit)}</span>` : ""}</li>`).join("")}</ul><p class="kecil" style="margin:10px 0 0">Sumber: turnbackhoax.id (MAFINDO).</p>` : `<p class="kecil" style="margin:0">Daftar hoaks belum tersedia.</p>`;
  }

  // ------------------------------------------------------------ arsip
  const temaGelap = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  function arsip() {
    const a = D.arsip ? D.arsip.bulan || [] : [], r = D.ringkasan;
    const total = a.reduce((s, b) => s + b.kasus, 0), tg = a.reduce((s, b) => s + b.tanggapan_terlihat, 0);
    const kpi = [
      [fmt(total), "kasus terarsip", r ? `sejak arsip dimulai · riwayat ${fmt(r.hari_riwayat)} hari` : "menunggu putaran pertama"],
      [total ? fmt(100 * tg / total, 0) + "%" : "—", "tanggapan terlihat", "kasus yang tanggapan polisi atau petugasnya muncul di pemberitaan"],
      [a.length && a[a.length - 1].median_jeda_jam != null ? fmt(a[a.length - 1].median_jeda_jam, 1) + " jam" : "—", "median jeda bulan ini", "dari berita pertama sampai berita tanggapan"],
    ];
    $("arsip-kpi").innerHTML = kpi.map(k => `<div class="kartu blok" style="box-shadow:none"><div style="font:800 28px var(--font-judul)" class="num">${k[0]}</div><b>${k[1]}</b><div class="kecil">${k[2]}</div></div>`).join("");
    if (!a.length) { $("arsip-narasi").textContent = "Arsip mulai terisi setelah putaran pertama."; $("tabel-bulan").innerHTML = ""; $("tabel-panas").innerHTML = ""; return; }
    const b = a[a.length - 1], nm = `${BLN_P[+b.bulan.slice(5) - 1]} ${b.bulan.slice(0, 4)}`;
    const topT = Object.entries(b.topik).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${TOPIK[k].toLowerCase()} (${fmt(v)})`).join(", ");
    const topP = (b.provinsi_teratas || []).slice(0, 3).map(([p, v]) => `${p} (${fmt(v)})`).join(", ");
    $("arsip-narasi").innerHTML = `<b>Kronik ${nm}, sementara.</b> PEKA mencatat ${fmt(b.kasus)} kasus keluhan publik. Topik terbanyak: ${topT || "—"}. Provinsi terbanyak: ${topP || "—"}. Tanggapan polisi atau petugas terlihat di pemberitaan pada ${fmt(b.tanggapan_terlihat)} kasus${b.median_jeda_jam != null ? `, median ${fmt(b.median_jeda_jam, 1)} jam setelah berita pertama` : ""}. <span class="kecil">Kalimat ini disusun otomatis dari arsip; inilah bentuk kronik tahunan yang diusulkan bagi Pusat Sejarah Polri.</span>`;
    $("tabel-bulan").innerHTML = `<thead><tr><th>Bulan</th><th class="n">Kasus</th>${URUT.map(s => `<th class="n">${ST[s].ikon} ${ST[s].nama}</th>`).join("")}<th class="n">Tanggapan terlihat</th><th class="n">Median jeda (jam)</th><th>Provinsi teratas</th></tr></thead><tbody>` +
      a.slice().reverse().map(x => `<tr><td>${BLN_P[+x.bulan.slice(5) - 1]} ${x.bulan.slice(0, 4)}</td><td class="n">${fmt(x.kasus)}</td>${URUT.map(s => `<td class="n">${fmt(x.status[s] || 0)}</td>`).join("")}<td class="n">${fmt(x.tanggapan_terlihat)}</td><td class="n">${fmt(x.median_jeda_jam, 1)}</td><td>${(x.provinsi_teratas || []).slice(0, 3).map(p => esc(p[0])).join(", ")}</td></tr>`).join("") + "</tbody>";
    const maks = Math.max(1, ...a.flatMap(x => Object.values(x.topik)));
    $("tabel-panas").innerHTML = `<thead><tr><th>Topik</th>${a.map(x => `<th class="n">${BLN[+x.bulan.slice(5) - 1]} ${x.bulan.slice(2, 4)}</th>`).join("")}</tr></thead><tbody>` +
      Object.keys(TOPIK).map(k => `<tr><td>${TOPIK[k]}</td>${a.map(x => { const v = x.topik[k] || 0, kl = v ? Math.min(6, 1 + Math.floor(5 * v / maks)) : 0; return `<td class="sel-panas" style="background:var(--seq-${kl});color:${kl >= 4 ? (temaGelap() ? "#08101f" : "#fff") : "var(--ink)"}">${v ? fmt(v) : ""}</td>`; }).join("")}</tr>`).join("") + "</tbody>";
  }

  // ------------------------------------------------------------ uji ambang (Tabel 4.6)
  const PRESET = {
    darurat: { pidana: 1, berlangsung: 1, jiwa: 1, lokasi: 1, bukti: 0, berat: 0, anggota: 0, perkara: 0, akun: 1, hariini: 2, rata: 1.5 },
    tindak: { pidana: 1, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, berat: 0, anggota: 0, perkara: 0, akun: 4, hariini: 3, rata: 2 },
    berat: { pidana: 1, berlangsung: 0, jiwa: 1, lokasi: 1, bukti: 0, berat: 1, anggota: 0, perkara: 0, akun: 1, hariini: 1, rata: 1 },
    pantau: { pidana: 0, berlangsung: 0, jiwa: 0, lokasi: 0, bukti: 0, berat: 0, anggota: 0, perkara: 0, akun: 2, hariini: 9, rata: 3.5 },
    anggota: { pidana: 1, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, berat: 0, anggota: 1, perkara: 0, akun: 1, hariini: 1, rata: 1 },
    perkara: { pidana: 1, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, berat: 1, anggota: 0, perkara: 1, akun: 2, hariini: 1, rata: 1 },
    tercatat: { pidana: 0, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, berat: 0, anggota: 0, perkara: 0, akun: 1, hariini: 2, rata: 3 },
  };
  const CIRI = ["pidana", "berlangsung", "jiwa", "lokasi", "bukti", "berat", "anggota", "perkara"];
  // Urutan sama dengan pipeline: jalur khusus, darurat, tindak, pantau, tercatat.
  function timbangUji(x) {
    const why = [];
    if (x.perkara) { why.push("<code>keluhan atas penanganan perkara</code> (laporan mandek, SP2HP tidak diterima, penghentian)"); return { s: "JALUR KHUSUS", t: "Diteruskan ke pengawas penyidikan dan inspektorat; tidak dikirim ke penyidik yang dikeluhkan", pj: "Bagwassidik Direktorat Reserse Polda dan Itwasda; tembusan Kompolnas (perkara di Polda: Biro Wassidik Bareskrim dan Itwasum)", b: "Tanda terima ≤72 jam; SP3D ≤20 hari kerja", biaya: "jalur terpisah", why }; }
    if (x.anggota && x.berat) { why.push("<code>keluhan tentang anggota</code> + <code>korban jiwa, luka berat, atau kekerasan</code>"); return { s: "JALUR KHUSUS", t: "Kekerasan oleh aparat: Propam dan reserse satu tingkat di atas satuan pelaku; satu laporan cukup", pj: "Bidpropam Polda dan Ditreskrimum Polda; tembusan Kompolnas; Komnas HAM bila ada kematian atau penyiksaan", b: "Tanda terima ≤24 jam; SP3D ≤20 hari kerja", biaya: "jalur terpisah", why }; }
    if (x.anggota) { why.push("<code>keluhan tentang perilaku anggota</code>"); return { s: "JALUR KHUSUS", t: "Diteruskan ke Propam satu tingkat di atas satuan yang dikeluhkan; tidak dikirim ke satuan itu sendiri", pj: "Anggota Polsek: Seksi Propam Polres · anggota Polres: Bidpropam Polda · anggota Polda: Divpropam Polri; tembusan Kompolnas", b: "Tanda terima ≤72 jam; SP3D ≤20 hari kerja", biaya: "jalur terpisah", why }; }
    if (x.berlangsung && x.jiwa && x.lokasi) { why.push("<code>sedang berlangsung</code> + <code>ancaman jiwa</code> + <code>lokasi jelas</code>"); return { s: "DARURAT", t: "Teruskan ke layanan 110 dan Sat Samapta; verifikasi sambil bergerak. Dari berita, status ini hanya pembanding kanal 110", pj: "Layanan 110 dan Sat Samapta Polres", b: "Diteruskan ≤5 menit", biaya: "biaya tindakan tinggi", why }; }
    if (x.pidana && x.lokasi && (x.bukti || x.berat || x.akun >= 3)) { why.push("<code>pidana/keselamatan</code> + <code>lokasi jelas</code> + " + (x.berat ? "<code>korban jiwa, luka berat, atau kekerasan seksual</code>" : x.bukti ? "<code>ada bukti</code>" : `<code>${fmt(x.akun)} akun berbeda ≥ 3 dalam 72 jam</code>`)); return { s: "TINDAK", t: "Periksa lokasi, hubungi pelapor, tindak sesuai hasil pemeriksaan", pj: x.berat ? "Kasat Reskrim Polres; Kapolsek setempat (Unit PPA untuk perempuan dan anak; Kasat Lantas untuk kecelakaan)" : "Kapolsek; Kasat Reskrim bila pidana berat", b: "Pemeriksaan ≤24 jam; kabar balik ≤72 jam", biaya: "biaya tindakan sedang", why }; }
    const lonjak = x.hariini >= 2 * x.rata && x.hariini >= 5;
    if (lonjak || x.pidana) { why.push(lonjak ? `<code>${fmt(x.hariini)} kasus hari ini ≥ 2 × rata-rata ${fmt(x.rata, 1)} dan ≥ 5</code>` : "<code>pidana/keselamatan</code> tanpa bukti, tanpa korban berat, dan < 3 akun (atau lokasi belum jelas)"); return { s: "PANTAU", t: "Pemeriksaan murah: Bhabinkamtibmas menghubungi pelapor atau mengecek lokasi", pj: "Kanit Reskrim Polsek; Bhabinkamtibmas menghubungi warga", b: "≤24 jam", biaya: "biaya tindakan rendah", why }; }
    why.push("tidak ada ambang yang terpenuhi");
    return { s: "TERCATAT", t: "Masuk rekap pola keluhan; pelapor menerima jawaban berisi kanal resmi", pj: "Kasat Binmas Polres", b: "Rekap mingguan", biaya: "biaya tindakan sangat rendah", why };
  }
  const angka = id => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : 0; };
  function uji() {
    const x = {}; CIRI.forEach(k => x[k] = $("u-" + k).checked); x.akun = angka("u-akun"); x.hariini = angka("u-hariini"); x.rata = angka("u-rata");
    const r = timbangUji(x), p = $("u-pill");
    p.textContent = ST[r.s].ikon + " " + ST[r.s].nama.toUpperCase(); p.className = "pill s-" + ST[r.s].cls;
    $("u-tindakan").textContent = r.t; $("u-pj").textContent = r.pj; $("u-batas").textContent = r.b; $("u-biaya").textContent = r.biaya;
    $("u-mengapa").innerHTML = "Aturan yang terpenuhi: " + r.why.join("; ");
    $("u-khusus").classList.toggle("sembunyi", !(x.anggota || x.perkara));
  }
  function pakaiPreset(n) {
    const v = PRESET[n]; CIRI.forEach(k => $("u-" + k).checked = !!v[k]);
    $("u-akun").value = v.akun; $("u-hariini").value = v.hariini; $("u-rata").value = v.rata;
    document.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", b.dataset.preset === n ? "true" : "false"));
    uji();
  }
  document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => pakaiPreset(b.dataset.preset)));
  $("f-uji").addEventListener("input", () => { document.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", "false")); uji(); });
  $("f-uji").addEventListener("submit", e => e.preventDefault());
  $("tabel-status").innerHTML = `<thead><tr><th>Status</th><th>Kondisi (ambang awal)</th><th>Tindakan</th><th>Penanggung jawab</th><th>Batas waktu</th></tr></thead><tbody>
    <tr><td>${lencana("DARURAT")}</td><td>Kejadian sedang berlangsung, ada ancaman terhadap keselamatan jiwa, dan lokasi jelas. Kanal utamanya tetap 110; dari berita, status ini hanya pembanding</td><td>Teruskan ke layanan 110 dan Sat Samapta; verifikasi sambil bergerak</td><td>Layanan 110 dan Sat Samapta Polres; bencana: BPBD dan Basarnas memimpin, Polri mendukung</td><td>Diteruskan ≤5 menit</td></tr>
    <tr><td>${lencana("TINDAK")}</td><td>Kejadian pidana atau keselamatan dengan lokasi jelas yang disertai bukti, menimbulkan korban jiwa, luka berat, atau kekerasan seksual, atau dilaporkan ≥3 akun berbeda dalam 72 jam</td><td>Periksa lokasi, hubungi pelapor, tindak sesuai hasil pemeriksaan</td><td>Kapolsek; Kasat Reskrim bila pidana berat; Unit PPA untuk perempuan dan anak; Kasat Resnarkoba untuk narkoba; Kasat Lantas untuk kecelakaan</td><td>Pemeriksaan ≤24 jam; kabar balik ≤72 jam</td></tr>
    <tr><td>${lencana("PANTAU")}</td><td>Kasus harian satu topik di satu wilayah ≥2 × rata-rata 28 hari dan minimal 5; atau satu keluhan pidana tanpa bukti</td><td>Pemeriksaan murah: Bhabinkamtibmas menghubungi pelapor atau mengecek lokasi</td><td>Kanit Reskrim Polsek; Bhabinkamtibmas menghubungi warga</td><td>≤24 jam</td></tr>
    <tr><td>${lencana("TERCATAT")}</td><td>Selain kondisi di atas, termasuk tindakan tegas yang dilaporkan polisi sendiri tanpa keberatan</td><td>Masuk rekap pola keluhan; pelapor menerima jawaban berisi kanal resmi</td><td>Kasat Binmas Polres</td><td>Rekap mingguan</td></tr>
    <tr><td>${lencana("JALUR KHUSUS")}</td><td>(a) Perilaku anggota: pungli, arogansi, pelanggaran disiplin atau etik</td><td>Propam satu tingkat di atas satuan yang dikeluhkan; tidak dikirim ke satuan itu sendiri</td><td>Anggota Polsek: Seksi Propam Polres · anggota Polres: Bidpropam Polda · anggota Polda: Divpropam Polri; Kompolnas menerima rekap bulanan (per kasus bila pejabat setingkat Kapolres ke atas). Perilaku anggota yang sudah diperiksa Propam atau diproses penyidik: Tercatat, dipantau kabar baliknya oleh Itwasda</td><td>Tanda terima ≤72 jam; SP3D ≤20 hari kerja</td></tr>
    <tr><td>${lencana("JALUR KHUSUS")}</td><td>(b) Kekerasan oleh aparat, kematian dalam tahanan, salah tembak</td><td>Propam dan reserse satu tingkat di atas; satu laporan cukup</td><td>Bidpropam dan Ditreskrimum Polda (pelaku di Polda: Divpropam dan Bareskrim); tembusan per kasus kepada Kompolnas; Komnas HAM bila ada kematian atau penyiksaan</td><td>Tanda terima ≤24 jam</td></tr>
    <tr><td>${lencana("JALUR KHUSUS")}</td><td>(c) Keluhan atas penanganan perkara: laporan mandek, SP2HP tidak diterima, penghentian penyidikan</td><td>Diteruskan ke pengawas penyidikan dan inspektorat; tidak dikirim ke penyidik yang dikeluhkan</td><td>Bagwassidik Direktorat Reserse Polda dan Itwasda (perkara di Polda: Biro Wassidik Bareskrim dan Itwasum); Kompolnas menerima rekap bulanan</td><td>Tanda terima ≤72 jam; SP3D ≤20 hari kerja</td></tr>
    <tr><td>${lencana("JALUR KHUSUS")}</td><td>(d) Laporan warga ditolak atau warga disuruh pulang</td><td>Diteruskan ke inspektorat; Propam bila ada unsur perilaku</td><td>Itwasda; Bidpropam Polda bila ada unsur perilaku</td><td>Tanda terima ≤72 jam</td></tr></tbody>`;
  pakaiPreset("tindak");

  // ------------------------------------------------------------ sejarah & data
  const BABAK = [
    ["sebelum 1945 (latar)", "Polisi untuk ketertiban penguasa", "Kepolisian kolonial dan masa pendudukan Jepang menjaga ketertiban yang dikehendaki penguasa. Saluran yang ada tidak dirancang agar warga pribumi dapat mengeluhkan polisi secara efektif.", "Mendengar warga harus dirancang dengan sengaja.", "Bloembergen (2011); Tokubetsu Keisatsutai di Surabaya"],
    ["1945–1959", "Lahir bersama rakyat", "Proklamasi Polisi oleh Inspektur Polisi Kelas I Moehammad Jasin dan Polisi Istimewa Surabaya, 21 Agustus 1945, menyatakan polisi bersatu dengan rakyat. Sejak 1 Juli 1946 Jawatan Kepolisian Negara di bawah Perdana Menteri (Hari Bhayangkara). Tribrata diikrarkan 1955.", "Janji dasar: polisi bersatu dengan rakyat.", "Penetapan Pemerintah 1946 No. 11/S.D.; Kep. Kapolri 95/I/2024 (Hari Juang Polri)"],
    ["1960–1998", "Bagian angkatan bersenjata", "Polri menjadi unsur Angkatan Bersenjata, tetapi UU 13/1961 berjanji \"menjunjung tinggi hak-hak azasi rakyat\". Pada kasus Sum Kuning (1970) pelapor justru dijadikan tersangka; pada kasus Sengkon dan Karta tersangka dipaksa mengaku. Koreksi datang dari luar kepolisian.", "Keluhan tentang anggota tidak boleh diperiksa satuan yang dikeluhkan.", "TAP MPRS II/MPRS/1960; UU 13/1961; Perma 1/1980; KUHAP 1981"],
    ["1999–2004", "Reformasi kelembagaan", "Polri dipisah dari ABRI. Buku Biru 1999 merumuskan reformasi struktural, instrumental, dan kultural. UU 2/2002 membuka Kompolnas untuk menerima keluhan masyarakat tentang kinerja kepolisian.", "Aturan perlu cara kerja agar berjalan.", "Inpres 2/1999; TAP VI dan VII/MPR/2000; UU 2/2002 Pasal 38"],
    ["2005–2020", "Kemitraan dan saluran resmi", "Polmas, Kompolnas (2005), LAPOR!, contact center 110 (2013), aturan pengaduan masyarakat, dan program Promoter. Layanan 110 tahun 2013 dibanjiri panggilan kosong atau iseng; keluhan tentang polisi tetap mengalir ke Komnas HAM dan Ombudsman.", "Saluran perlu dipilah agar keluhan sungguhan tidak tenggelam.", "Perpres 17/2005 dan 17/2011; Skep/737/X/2005; Perkap 2/2012"],
    ["2021–2026", "Era viral", "Dumas Presisi dan virtual police (Februari 2021), tagar #PercumaLaporPolisi (Oktober 2021), Jumat Curhat (2023), Kapolri menyebut aduan sebagai sistem peringatan dini (2026), dan UU 5/2026 menegaskan kembali kewenangan Kompolnas.", "Dengar lebih awal, timbang dengan ambang tertulis, kabarkan kembali.", "SE Kapolri SE/2/II/2021; Perpol 2/2024; UU 5/2026"],
  ];
  $("babak").innerHTML = BABAK.map((b, i) => `<div class="kartu bb"><div class="th">BABAK ${["I", "II", "III", "IV", "V", "VI"][i]} · ${b[0]}</div><h4>${b[1]}</h4><p>${b[2]}</p><div class="pel"><b>Pelajaran untuk PEKA:</b> ${b[3]}</div><div class="sumber-bb">Dasar dan sumber: ${b[4]}</div></div>`).join("");
  // Seandainya PEKA sudah ada: aturan mana yang menyala, dan kapan
  const SEANDAINYA = [
    ["Sum Kuning, Yogyakarta (1970)", "Korban melapor, lalu justru dijadikan tersangka", "Jalur khusus pada hari pelapor diperlakukan sebagai tersangka: keluhan ke Propam dan Kompolnas, bukan ke satuan yang memeriksanya; tanda terima ≤72 jam"],
    ["Sengkon dan Karta, Bekasi (1974–1980)", "Pengakuan diduga diperoleh dengan kekerasan; kebenaran terungkap setelah 6 tahun", "Jalur khusus atas dugaan kekerasan dalam pemeriksaan, diawasi pihak luar sejak keluhan pertama"],
    ["Luwu Timur, Sulsel (2019–2021)", "Penyelidikan dihentikan; dibuka kembali 6 hari setelah viral", "Tindak sejak laporan (kekerasan seksual terhadap anak); kabar balik ≤72 jam; penghentian tercatat dan terlihat oleh pengawas"],
    ["Pulogadung, Jakarta Timur (2021)", "Laporan ditolak; viral hari ke-3; tindakan hari ke-5", "Jalur khusus pada hari ke-0 karena laporan ditolak petugas; tanda terima ≤72 jam, sebelum viral"],
    ["Cirebon, Jabar (2016–2024)", "Penangkapan setelah viral dibatalkan praperadilan 48 hari kemudian", "Status ditentukan ambang tertulis dan bukti, bukan ramainya berita; lacak kabar menjelaskan kepada publik apa yang sedang diperiksa"],
  ];
  if ($("seandainya")) $("seandainya").innerHTML = `<thead><tr><th>Kasus</th><th>Yang terjadi</th><th>Bila PEKA sudah ada</th></tr></thead><tbody>` + SEANDAINYA.map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("") + "</tbody>";
  const K9 = [
    ["Pulogadung, Jakarta Timur", "2021", "Perampokan; laporan ditolak petugas", "2021-12-07", "2021-12-10", "2021-12-12"],
    ["Deli Serdang, Sumut", "2021", "Korban penganiayaan sempat jadi tersangka · ~", "2021-09-05", "2021-10-08", "2021-10-12"],
    ["Cakung, Jakarta Timur", "2024", "Penganiayaan di tempat kerja", "2024-10-18", "2024-12-15", "2024-12-16"],
    ["Mojokerto, Jatim", "2021", "Aduan awal ke Komnas Perempuan · ~", "2021-08-15", "2021-12-04", "2021-12-04"],
    ["Medan, Sumut", "2022–2023", "Penganiayaan; anggota membiarkan", "2022-12-22", "2023-04-25", "2023-04-25"],
    ["Luwu Timur, Sulsel", "2019–2021", "Dugaan kekerasan seksual terhadap anak", "2019-10-09", "2021-10-06", "2021-10-12"],
    ["Kota Bogor, Jabar", "2019–2022", "Tanggal awal = tanggal kejadian · ~", "2019-12-15", "2022-10-25", "2022-11-21"],
    ["Cirebon, Jabar", "2016–2024", "Tanggal awal = tanggal kejadian", "2016-08-27", "2024-05-08", "2024-05-21"],
    ["Lombok Tengah, NTB", "2022", "Korban begal jadi tersangka; tanpa laporan awal · ~", null, "2022-04-13", "2022-04-16"],
  ];
  const hariAntara = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  function kasus9() {
    const el = $("kasus9"); if (!el) return;
    const sc = v => Math.log10(1 + v) / Math.log10(1 + 3200);
    el.innerHTML = K9.map(k => {
      const a = k[3] ? hariAntara(k[3], k[4]) : null, b = hariAntara(k[4], k[5]), tot = k[3] ? hariAntara(k[3], k[5]) : null;
      return `<div class="k9"><div class="nm">${k[0]} (${k[1]})<small>${k[2]}</small></div>
        <div class="bar"><div class="jalur">${a != null ? `<span class="a" style="width:${sc(a) * 100}%"></span>` : `<span class="tanpa">tanpa laporan awal</span>`}<span class="mk" style="left:${sc(3) * 100}%"></span></div>
          <div class="jalur jalur-b"><span class="b" style="width:${Math.max(1, sc(b) * 100)}%"></span><span class="mk" style="left:${sc(3) * 100}%"></span></div>
        <div class="kecil mono" style="margin-top:3px">${a != null ? fmt(a) + " hari menunggu · " : ""}${b} hari bergerak</div></div>
        <div class="tot">${tot != null ? fmt(tot) + " hari" : "—"}<small>sampai tindakan</small></div></div>`;
    }).join("");
  }
  function garis(svg, opt) {
    if (!svg || !svg.getBoundingClientRect().width) return;
    const W = svg.getBoundingClientRect().width, H = 270, L = 40, R = 16, T = 18, B = 30;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const X = v => L + (v - opt.x0) / (opt.x1 - opt.x0) * (W - L - R), Y = v => T + (1 - (v - opt.y0) / (opt.y1 - opt.y0)) * (H - T - B);
    let h = "";
    opt.yt.forEach(v => { h += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--border")}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${css("--ink-3")}">${v}</text>`; });
    opt.xt.forEach(v => { h += `<text x="${X(v)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="${css("--ink-3")}">${Math.floor(v)}</text>`; });
    (opt.tanda || []).forEach(m => { h += `<line x1="${X(m[0])}" x2="${X(m[0])}" y1="${T}" y2="${H - B}" stroke="${css("--ink-3")}" stroke-dasharray="3 3"/><text x="${X(m[0]) - 4}" y="${T + 10}" text-anchor="end" font-size="11" fill="${css("--ink-2")}">${m[1]}</text>`; });
    const titik = [];
    opt.seri.forEach(s => s.bagian.forEach(p => {
      h += `<path d="${p.map((q, i) => (i ? "L" : "M") + X(q[0]).toFixed(1) + " " + Y(q[1]).toFixed(1)).join(" ")}" fill="none" stroke="${css(s.warna)}" stroke-width="2"/>`;
      p.forEach(q => { h += `<circle cx="${X(q[0])}" cy="${Y(q[1])}" r="4" fill="${css(s.warna)}" stroke="${css("--surface")}" stroke-width="2"/>`; titik.push({ x: X(q[0]), y: Y(q[1]), lab: q[2] || q[0], v: q[1], nama: s.nama }); });
    }));
    (opt.label || []).forEach(l => { h += `<text x="${X(l[0]) + (l[3] || 0)}" y="${Y(l[1]) + (l[2] === "bawah" ? 18 : -9)}" text-anchor="middle" font-size="11" font-weight="700" fill="${css("--ink")}">${String(l[1]).replace(".", ",")}</text>`; });
    svg.innerHTML = h;
    svg.onpointermove = e => {
      const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width, y = (e.clientY - b.top) * H / b.height;
      let best = null, d0 = 1e9; titik.forEach(t => { const d = Math.hypot(t.x - x, t.y - y); if (d < d0) { d0 = d; best = t; } });
      if (best && d0 < 40) tunjuk(e, `<b>${esc(best.lab)}</b>${esc(best.nama)}: ${String(best.v).replace(".", ",")}%`); else sembunyikan();
    };
    svg.onpointerleave = sembunyikan;
  }
  function grafikBps() {
    garis($("g-bps"), { x0: 2018.6, x1: 2024.4, y0: 0, y1: 70, yt: [0, 20, 40, 60], xt: [2019, 2020, 2021, 2022, 2023, 2024], seri: [
      { nama: "korban kekerasan", warna: "--biru", bagian: [[[2019, 37.5], [2020, 52.43], [2021, 46.71], [2022, 57.75], [2023, 48.88], [2024, 39.25]]] },
      { nama: "seluruh korban", warna: "--garis-2", bagian: [[[2019, 22.19], [2020, 23.46], [2021, 23.31], [2022, 22.98], [2023, 23.36], [2024, 20.28]]] }],
      label: [[2022, 57.75], [2024, 39.25], [2024, 20.28], [2019, 22.19]] });
  }
  function grafikInd() {
    const T = s => { const [y, m] = s.split("-").map(Number); return y + (m - 0.5) / 12; };
    const nm = s => `${BLN_P[+s.slice(5) - 1]} ${s.slice(0, 4)}`;
    const a = [["2014-04", 57.6], ["2015-01", 68.6], ["2016-08", 73.2], ["2017-09", 76.5], ["2018-09", 79.8], ["2019-02", 80.5], ["2020-09", 72.3], ["2021-09", 70.9], ["2021-11", 80.2], ["2021-12", 74.1], ["2022-02", 75.2], ["2022-05", 77.3], ["2022-06", 76.4], ["2022-08", 69.6], ["2022-09", 62.6], ["2022-11", 60.5], ["2022-12", 66.0], ["2023-02", 70.8], ["2023-04", 73.2], ["2023-06", 76.4], ["2023-10", 76.4], ["2024-01", 75.0]];
    const b = [["2025-10", 66.0], ["2026-01", 65.0]];
    garis($("g-ind"), { x0: 2014, x1: 2026.4, y0: 50, y1: 85, yt: [50, 60, 70, 80], xt: [2014, 2016, 2018, 2020, 2022, 2024, 2026], tanda: [[T("2022-07"), "Brigadir J"], [T("2025-08"), "Unjuk rasa Agustus 2025"]],
      seri: [{ nama: "percaya", warna: "--garis-2", bagian: [a.map(r => [T(r[0]), r[1], nm(r[0])]), b.map(r => [T(r[0]), r[1], nm(r[0])])] }],
      label: [[T("2014-04"), 57.6, "atas", 6], [T("2019-02"), 80.5], [T("2022-11"), 60.5, "bawah"], [T("2026-01"), 65]] });
  }
  const PAGAR = [
    ["Tidak untuk menindak pendapat", "Data keluhan tidak boleh menjadi dasar laporan atau penyidikan atas kritik warga.", "Di sini: hanya judul berita publik yang dibaca; tidak ada akun atau unggahan warga."],
    ["Agregat dan anonim", "Dasbor hanya menampilkan jumlah per topik, wilayah, dan waktu.", "Di sini: arsip menyimpan topik, kode wilayah, status, dan jumlah; tanpa nama, judul, atau tautan. Daftar langsung menampilkan judul berita apa adanya, termasuk nama yang dimuat media."],
    ["Masa simpan terbatas", "Data mentah dihapus setelah kasus ditutup.", "Di sini: cache judul berita dihapus otomatis dari folder data setelah 4 hari (riwayat versi GitHub masih menyimpan salinan lamanya; isinya hanya judul berita publik)."],
    ["Diawasi pihak luar", "Kompolnas memeriksa catatan pemakaian sistem setiap tahun.", "Di sini: kode dan setiap putaran tercatat terbuka di riwayat GitHub."],
    ["Aturan terbuka", "Daftar topik, ambang status, dan sumber data diumumkan.", "Di sini: semua aturan ada di tab ini dan di config/topik.json."],
  ];
  $("pagar").innerHTML = PAGAR.map(p => `<div class="kartu"><b>${p[0]}</b><p>${p[1]}</p><div class="terapan">✓ ${p[2]}</div></div>`).join("");

  // ------------------------------------------------------------ mulai
  const awal = decodeURIComponent(location.hash.slice(1));
  if (awal.startsWith("lacak=")) { buka("pantau", false, true); lacakTunda = awal.slice(6); }
  else if (awal.startsWith("polda=")) { poldaPilih = awal.slice(6); buka("polda", false, true); }
  else buka(awal || "ringkasan");
  gambarSemua();
  muatPeta();
  muat();
  setInterval(muat, 5 * 60 * 1000);            // ambil ulang data setiap 5 menit
  setInterval(() => { sampul(); }, 60 * 1000);  // perbarui "x menit lalu"
})();
