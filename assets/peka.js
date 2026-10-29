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
  const D = { ringkasan: null, kasus: null, gdelt: null, bmkg: null, arsip: null, sumber: null };
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
    try { localStorage.setItem("peka-tema", baru); } catch (e) { /* abaikan */ }
    gambarGrafik();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", gambarGrafik);

  // ------------------------------------------------------------ tab
  const TABS = ["ringkasan", "pantau", "tren", "uji", "arsip", "sejarah", "metodologi"];
  function buka(tab, gulir) {
    if (!TABS.includes(tab)) tab = "ringkasan";
    document.querySelectorAll(".tabbtn").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false"));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("aktif", p.id === "tab-" + tab));
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
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
  addEventListener("hashchange", () => buka(location.hash.slice(1)));

  // ------------------------------------------------------------ data
  async function ambil(nama) {
    try {
      const r = await fetch("data/" + nama + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function muat() {
    const [ri, ka, gd, bm, ar, su] = await Promise.all(["ringkasan.json", "kasus_terkini.json", "gdelt_tren.json", "bmkg.json", "arsip_bulanan.json", "status_sumber.json"].map(ambil));
    Object.assign(D, { ringkasan: ri, kasus: ka, gdelt: gd, bmkg: bm, arsip: ar, sumber: su });
    gambarSemua();
  }

  function gambarSemua() {
    sampul(); spanduk(); kartuStatus(); narasi(); langkah(); prioritas(); sumber();
    isiSaring(); peta(); daftar(); lonjakanWilayah(); multi(); gempa(); hoaks(); arsip();
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
    bag.push(`${s["TINDAK"]} perlu ditindak`);
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
    if (!D.ringkasan) {
      el.innerHTML = `<div class="spanduk">Data pantauan langsung belum ada. Pemilik repositori perlu menjalankan alur kerja <b>PEKA - dengar keluhan publik</b> sekali dari tab <b>Actions</b> di GitHub; setelah itu halaman terisi sendiri setiap jam. Tab Uji Ambang, Sejarah &amp; Data, dan Metodologi tetap dapat dipakai.</div>`;
    } else if (umurJam(D.ringkasan.diperbarui_utc) > 3) {
      el.innerHTML = `<div class="spanduk">Putaran terakhir ${lalu(D.ringkasan.diperbarui_utc)}. Jadwal GitHub kadang mundur; data di bawah tetap hasil putaran terakhir.</div>`;
    } else el.innerHTML = "";
  }

  // ------------------------------------------------------------ ringkasan
  function kartuStatus() {
    const r = D.ringkasan, s = r ? r.status : {};
    $("r-kurun").textContent = r ? "putaran " + wib(r.diperbarui_utc, { year: undefined }) : "menunggu data";
    $("kartu-status").innerHTML = URUT.map(k => `<button type="button" class="st s-${ST[k].cls}" data-status="${k}">
      <span class="angka num">${r ? fmt(s[k]) : "–"}</span><span class="nama">${ST[k].ikon} ${ST[k].nama}</span>
      <span class="ket">${ST[k].ket}</span><span class="lihat">lihat daftarnya →</span></button>`).join("");
    $("kartu-status").querySelectorAll("[data-status]").forEach(b => b.addEventListener("click", () => {
      F.status = b.dataset.status; F.n = 24; isiSaring(); daftar(); buka("pantau", "paksa");
    }));
  }
  function narasi() {
    const r = D.ringkasan;
    if (!r) { $("narasi").textContent = "Begitu putaran pertama selesai, ringkasan kondisi muncul di sini."; return; }
    const L = r.langkah, s = r.status, kb = L.kabarkan;
    const perlu = s["DARURAT"] + s["TINDAK"] + s["JALUR KHUSUS"];
    let t = `Dalam 72 jam terakhir PEKA menyusun <b>${fmt(r.kasus_aktif)} kasus keluhan</b> dari berita daring. `;
    t += perlu ? `<b>${fmt(perlu)} kasus</b> perlu tindakan segera (${fmt(s["DARURAT"])} darurat, ${fmt(s["TINDAK"])} tindak, ${fmt(s["JALUR KHUSUS"])} jalur khusus ke Propam), diteruskan ke <b>${fmt(L.teruskan.polda)} Polda</b>. ` : "Tidak ada kasus yang memerlukan tindakan segera. ";
    t += `Tanggapan polisi atau petugas sudah terlihat di pemberitaan pada <b>${fmt(kb.tanggapan_terlihat)} kasus</b>`;
    t += kb.median_jeda_jam != null ? `, dengan median jeda <b>${fmt(kb.median_jeda_jam, 1)} jam</b> setelah berita pertama (${fmt(kb.n_jeda)} kasus yang jedanya terukur). ` : ". ";
    if (kb.melewati_batas) t += `<b>${fmt(kb.melewati_batas)} kasus</b> sudah melewati batas kabar balik statusnya tanpa tanggapan yang terlihat. `;
    const nas = (r.lonjakan_nasional || []).filter(x => x.lonjakan);
    if (nas.length) t += `Secara nasional, volume berita <b>${nas.map(x => x.nama.toLowerCase()).join(", ")}</b> kemarin melampaui 2 × rata-rata 28 hari. `;
    t += `<span class="kecil">Putaran terakhir membaca ${fmt(L.dengar.artikel)} berita; ${fmt(L.pilah.hoaks)} bertanda hoaks dan ${fmt(L.pilah.tidak_relevan)} yang tidak relevan dibuang.</span>`;
    $("narasi").innerHTML = t;
  }
  function langkah() {
    const r = D.ringkasan, L = r ? r.langkah : null;
    const kol = [
      ["01", "Dengar", L ? fmt(L.dengar.artikel) : "–", "berita terbaca", L ? `dari ${L.dengar.sumber} sumber terbuka pada putaran terakhir` : "berita daring, GDELT, BMKG, MAFINDO"],
      ["02", "Pilah", L ? fmt(L.pilah.kasus_baru) : "–", "kasus baru", L ? `${fmt(L.pilah.digabung)} berita digabung ke kasus yang ada, ${fmt(L.pilah.sudah_ada)} sudah pernah terbaca, ${fmt(L.pilah.hoaks)} hoaks disaring` : "duplikat, hoaks, topik, lokasi"],
      ["03", "Timbang", r ? fmt(r.kasus_aktif) : "–", "kasus aktif", r ? URUT.map(k => `${ST[k].ikon} ${fmt(r.status[k])}`).join(" · ") : "lima status dengan ambang tertulis"],
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
      <details class="artikel"><summary>Berita dalam kasus ini (${fmt(h.n_artikel)})</summary><ul>${art}</ul></details>
    </article>`;
  }
  function prioritas() {
    const k = D.kasus ? D.kasus.kasus : [];
    let p = k.filter(h => ["DARURAT", "JALUR KHUSUS", "TINDAK"].includes(h.status)).slice(0, 6);
    if (!p.length) p = k.slice(0, 4);
    $("prioritas").innerHTML = p.length ? p.map(kartuKasus).join("") : `<div class="kartu kosong">Belum ada kasus. Daftar muncul setelah putaran pertama.</div>`;
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
    svg.onclick = e => { const i = e.target.dataset?.i; if (i == null) return; F.topik = item[i].k; F.status = ""; isiSaring(); daftar(); buka("pantau", "paksa"); };
  }

  // ------------------------------------------------------------ pantau langsung
  const PETAK = {
    "11": [1, 1, "Aceh"], "12": [2, 2, "Sumut"], "13": [2, 3, "Sumbar"], "14": [3, 2, "Riau"], "21": [4, 2, "Kepri"],
    "15": [3, 3, "Jambi"], "17": [2, 4, "Bklu"], "16": [3, 4, "Sumsel"], "19": [4, 4, "Babel"], "18": [3, 5, "Lpg"],
    "36": [4, 6, "Banten"], "31": [5, 5, "DKI"], "32": [5, 6, "Jabar"], "33": [6, 6, "Jateng"], "34": [6, 7, "DIY"],
    "35": [7, 6, "Jatim"], "51": [8, 6, "Bali"], "52": [9, 6, "NTB"], "53": [10, 6, "NTT"],
    "61": [6, 2, "Kalbar"], "62": [7, 3, "Kalteng"], "63": [8, 3, "Kalsel"], "64": [8, 2, "Kaltim"], "65": [8, 1, "Kaltara"],
    "75": [10, 1, "Gtlo"], "71": [11, 1, "Sulut"], "72": [10, 2, "Sulteng"], "76": [9, 3, "Sulbar"], "73": [9, 4, "Sulsel"], "74": [10, 4, "Sultra"],
    "82": [12, 2, "Malut"], "81": [12, 4, "Maluku"], "92": [13, 3, "PBD"], "91": [14, 3, "Pabar"], "94": [15, 3, "Papua"],
    "96": [14, 4, "Pteng"], "97": [15, 4, "Ppeg"], "95": [15, 5, "Psel"],
  };
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
    $("jumlah-saring").textContent = D.kasus ? `${fmt(k.length)} kasus cocok dengan saringan · diperbarui ${lalu(D.kasus.diperbarui_utc)}` : "";
    $("daftar").innerHTML = k.length ? k.slice(0, F.n).map(kartuKasus).join("") : `<div class="kartu kosong">Tidak ada kasus yang cocok${D.kasus ? "" : " (menunggu putaran pertama)"}.</div>`;
    $("muat-lagi").classList.toggle("sembunyi", k.length <= F.n);
  }
  function peta() {
    const r = D.ringkasan, prov = r ? r.provinsi || {} : {};
    const tot = c => URUT.reduce((s, k) => s + (prov[c] && prov[c][k] ? prov[c][k] : 0), 0);
    const maks = Math.max(1, ...Object.keys(PETAK).map(tot));
    const kelas = v => v <= 0 ? 0 : Math.min(6, 1 + Math.floor(5 * Math.log(1 + v) / Math.log(1 + maks)));
    const el = $("peta");
    el.style.gridTemplateColumns = "repeat(15, minmax(0,1fr))";
    el.innerHTML = Object.entries(PETAK).map(([c, [x, y, ab]]) => {
      const v = tot(c), kl = kelas(v), tertinggi = URUT.find(k => prov[c] && prov[c][k]);
      const warna = tertinggi ? css("--" + ({ "DARURAT": "darurat", "JALUR KHUSUS": "khusus", "TINDAK": "tindak", "PANTAU": "pantau", "TERCATAT": "tercatat" }[tertinggi]) + "-tanda") : "";
      return `<button type="button" class="petak" data-l="${kl}" style="grid-column:${x};grid-row:${y};background:var(--seq-${kl})" data-p="${c}" aria-pressed="${F.prov === c}" aria-label="${NAMA_PROV[c]}: ${v} kasus">
        ${ab}<br><span class="num">${v || ""}</span>${tertinggi ? `<span class="tanda" style="background:${warna}"></span>` : ""}</button>`;
    }).join("");
    el.querySelectorAll(".petak").forEach(b => {
      b.onclick = () => { F.prov = F.prov === b.dataset.p ? "" : b.dataset.p; F.n = 24; isiSaring(); daftar(); peta(); };
      b.onpointermove = e => { const c = b.dataset.p, p = prov[c] || {}; tunjuk(e, `<b>${NAMA_PROV[c]}</b>${(r && r.provinsi[c]) ? esc(r.provinsi[c].polda) + "<br>" : ""}${URUT.filter(k => p[k]).map(k => `${ST[k].ikon} ${ST[k].nama}: ${p[k]}`).join("<br>") || "tidak ada kasus aktif"}`); };
      b.onpointerleave = sembunyikan;
    });
    $("legenda-peta").innerHTML = `<span>sedikit</span>${[1, 2, 3, 4, 5, 6].map(i => `<i style="background:var(--seq-${i})"></i>`).join("")}<span>banyak kasus</span>
      <span style="margin-left:14px">titik: ${URUT.map(k => `${ST[k].ikon} ${ST[k].nama}`).join(" · ")}</span>`;
  }

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
      ${darurat ? lencana("DARURAT") : `<span class="segar">${lalu(g.waktu_utc)}</span>`}</div>
      <p style="margin:6px 0 4px">${esc(g.wilayah)}</p>
      <p class="kecil" style="margin:0">${wib(g.waktu_utc)} · kedalaman ${esc(g.kedalaman)} · ${esc(g.potensi || "")}${g.dirasakan ? " · dirasakan: " + esc(g.dirasakan) : ""}</p>
      ${daftarG.length ? `<div class="tabel-wadah" style="margin-top:12px"><table class="tbl"><thead><tr><th>Waktu</th><th class="n">M</th><th>Wilayah</th></tr></thead><tbody>${daftarG.map(x => `<tr><td>${wib(x.waktu_utc, { year: undefined })}</td><td class="n">${fmt(x.magnitudo, 1)}</td><td>${esc(x.wilayah)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="kecil" style="margin:10px 0 0">Sumber: BMKG.</p></div>`;
  }
  function hoaks() {
    const h = D.ringkasan ? D.ringkasan.hoaks_terbaru || [] : [];
    $("hoaks").innerHTML = h.length ? `<ul style="margin:0;padding-left:18px">${h.map(x => `<li style="margin:4px 0"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.judul)}</a> <span class="kecil">· ${lalu(x.terbit)}</span></li>`).join("")}</ul><p class="kecil" style="margin:10px 0 0">Sumber: turnbackhoax.id (MAFINDO).</p>` : `<p class="kecil" style="margin:0">Daftar hoaks belum tersedia.</p>`;
  }

  // ------------------------------------------------------------ arsip
  function arsip() {
    const a = D.arsip ? D.arsip.bulan || [] : [], r = D.ringkasan;
    const total = a.reduce((s, b) => s + b.kasus, 0), tg = a.reduce((s, b) => s + b.tanggapan_terlihat, 0);
    const kpi = [
      [fmt(total), "kasus terarsip", r ? `sejak arsip dimulai · riwayat ${fmt(r.hari_riwayat)} hari` : "menunggu putaran pertama"],
      [total ? fmt(100 * tg / total, 0) + "%" : "—", "tanggapan terlihat", "kasus yang tanggapan polisi atau petugasnya muncul di pemberitaan"],
      [a.length ? fmt(a[a.length - 1].median_jeda_jam, 1) + " jam" : "—", "median jeda bulan ini", "dari berita pertama sampai berita tanggapan"],
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
      Object.keys(TOPIK).map(k => `<tr><td>${TOPIK[k]}</td>${a.map(x => { const v = x.topik[k] || 0, kl = v ? Math.min(6, 1 + Math.floor(5 * v / maks)) : 0; return `<td class="sel-panas" style="background:var(--seq-${kl});color:${kl >= 4 ? "#fff" : "var(--ink)"}">${v ? fmt(v) : ""}</td>`; }).join("")}</tr>`).join("") + "</tbody>";
  }

  // ------------------------------------------------------------ uji ambang (Tabel 4.5)
  const PRESET = {
    darurat: { pidana: 1, berlangsung: 1, jiwa: 1, lokasi: 1, bukti: 0, anggota: 0, akun: 1, hariini: 2, rata: 1.5 },
    tindak: { pidana: 1, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, anggota: 0, akun: 4, hariini: 3, rata: 2 },
    pantau: { pidana: 0, berlangsung: 0, jiwa: 0, lokasi: 0, bukti: 0, anggota: 0, akun: 2, hariini: 9, rata: 3.5 },
    anggota: { pidana: 1, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, anggota: 1, akun: 1, hariini: 1, rata: 1 },
    tercatat: { pidana: 0, berlangsung: 0, jiwa: 0, lokasi: 1, bukti: 0, anggota: 0, akun: 1, hariini: 2, rata: 3 },
  };
  const CIRI = ["pidana", "berlangsung", "jiwa", "lokasi", "bukti", "anggota"];
  function timbangUji(x) {
    const why = [];
    if (x.berlangsung && x.jiwa && x.lokasi) { why.push("<code>sedang berlangsung</code> + <code>ancaman jiwa</code> + <code>lokasi jelas</code>"); return { s: "DARURAT", t: "Teruskan ke piket SPKT dan layanan 110; verifikasi sambil bergerak", pj: "Piket SPKT Polres atau Polsek", b: "Diteruskan ≤5 menit", biaya: "biaya tindakan tinggi", why }; }
    if (x.pidana && (x.bukti || x.akun >= 3)) { why.push(x.bukti ? "<code>pidana/keselamatan</code> + <code>ada bukti</code>" : `<code>pidana/keselamatan</code> + <code>${x.akun} akun berbeda ≥ 3 dalam 72 jam</code>`); return { s: "TINDAK", t: "Periksa lokasi, hubungi pelapor, tindak sesuai hasil pemeriksaan", pj: "Kapolsek; Kasat Reskrim bila pidana berat", b: "Pemeriksaan ≤24 jam; kabar balik ≤72 jam", biaya: "biaya tindakan sedang", why }; }
    const lonjak = x.hariini >= 2 * x.rata && x.hariini >= 5;
    if (lonjak || x.pidana) { why.push(lonjak ? `<code>${x.hariini} kasus hari ini ≥ 2 × rata-rata ${x.rata} dan ≥ 5</code>` : "<code>pidana/keselamatan</code> tanpa bukti dan < 3 akun"); return { s: "PANTAU", t: "Pemeriksaan murah: Bhabinkamtibmas menghubungi pelapor atau mengecek lokasi", pj: "Bhabinkamtibmas; bila belum ada, Kanit Binmas Polsek atau polisi RW", b: "≤24 jam", biaya: "biaya tindakan rendah", why }; }
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
    $("u-khusus").classList.toggle("sembunyi", !x.anggota);
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
    <tr><td>${lencana("DARURAT")}</td><td>Kejadian sedang berlangsung, ada ancaman terhadap keselamatan jiwa, dan lokasi jelas</td><td>Teruskan ke piket SPKT dan layanan 110; verifikasi sambil bergerak</td><td>Piket SPKT Polres atau Polsek</td><td>Diteruskan ≤5 menit</td></tr>
    <tr><td>${lencana("TINDAK")}</td><td>Kejadian pidana atau keselamatan disertai bukti, atau ≥3 akun berbeda melaporkan kejadian yang sama dalam 72 jam</td><td>Periksa lokasi, hubungi pelapor, tindak sesuai hasil pemeriksaan</td><td>Kapolsek; Kasat Reskrim bila pidana berat</td><td>Pemeriksaan ≤24 jam; kabar balik ≤72 jam</td></tr>
    <tr><td>${lencana("PANTAU")}</td><td>Kasus harian satu topik di satu wilayah ≥2 × rata-rata 28 hari dan minimal 5; atau satu keluhan pidana tanpa bukti</td><td>Pemeriksaan murah: Bhabinkamtibmas menghubungi pelapor atau mengecek lokasi</td><td>Bhabinkamtibmas; bila belum ada, Kanit Binmas Polsek atau polisi RW</td><td>≤24 jam</td></tr>
    <tr><td>${lencana("TERCATAT")}</td><td>Selain kondisi di atas</td><td>Masuk rekap pola keluhan; warga menerima jawaban berisi kanal resmi</td><td>Kasat Binmas Polres</td><td>Rekap mingguan</td></tr>
    <tr><td>${lencana("JALUR KHUSUS")}</td><td>Keluhan tentang pungutan liar, kekerasan, atau penolakan laporan oleh anggota</td><td>Diteruskan ke Propam dengan tembusan Kompolnas; tidak dikirim ke satuan yang dikeluhkan</td><td>Propam Polda; Kompolnas</td><td>Tanda terima ≤72 jam</td></tr></tbody>`;
  pakaiPreset("tindak");

  // ------------------------------------------------------------ sejarah & data
  const BABAK = [
    ["sampai 1945", "Polisi untuk ketertiban penguasa", "Kepolisian kolonial dan masa pendudukan Jepang menjaga ketertiban yang dikehendaki penguasa. Saluran yang ada tidak dirancang agar warga pribumi dapat mengeluhkan polisi secara efektif.", "Mendengar warga harus dirancang dengan sengaja."],
    ["1945–1959", "Lahir bersama rakyat", "Proklamasi Polisi 21 Agustus 1945 menyatakan polisi bersatu dengan rakyat. Sejak 1 Juli 1946 Jawatan Kepolisian Negara di bawah Perdana Menteri. Warga datang langsung kepada polisi.", "Janji dasar: polisi bersatu dengan rakyat."],
    ["1960–1998", "Bagian angkatan bersenjata", "Polri menjadi unsur ABRI (UU 13/1961). Pada kasus Sum Kuning (1970) pelapor justru diadili; pada kasus Sengkon dan Karta tersangka dipaksa mengaku. Koreksi datang dari luar kepolisian.", "Keluhan tentang anggota tidak boleh diperiksa satuan yang dikeluhkan."],
    ["1999–2004", "Reformasi kelembagaan", "Polri dipisah dari ABRI (Inpres 2/1999; TAP VI dan VII/MPR/2000). UU 2/2002 membuka Kompolnas untuk menerima keluhan masyarakat tentang kinerja kepolisian.", "Aturan perlu cara kerja agar berjalan."],
    ["2005–2020", "Kemitraan dan saluran resmi", "Polmas, Kompolnas (2005), LAPOR!, layanan 110 (2013), aturan pengaduan masyarakat, dan program Promoter. Layanan 110 tahun 2013 dibanjiri panggilan kosong atau iseng.", "Saluran perlu dipilah agar keluhan sungguhan tidak tenggelam."],
    ["2021–2026", "Era viral", "Dumas Presisi dan virtual police (Februari 2021), tagar #PercumaLaporPolisi (Oktober 2021), Kapolri menyebut aduan sebagai sistem peringatan dini (2026), dan UU 5/2026 memperkuat Kompolnas.", "Dengar lebih awal, timbang dengan ambang tertulis, kabarkan kembali."],
  ];
  $("babak").innerHTML = BABAK.map((b, i) => `<div class="kartu bb"><div class="th">BABAK ${["I", "II", "III", "IV", "V", "VI"][i]} · ${b[0]}</div><h4>${b[1]}</h4><p>${b[2]}</p><div class="pel"><b>Pelajaran untuk PEKA:</b> ${b[3]}</div></div>`).join("");
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
        <div class="bar"><div class="jalur">${a != null ? `<span class="a" style="width:${sc(a) * 86}%"></span>` : `<span class="tanpa">tanpa laporan awal</span>`}<span class="b" style="width:${Math.max(.8, sc(b) * 14)}%"></span>${a != null ? `<span class="mk" style="left:${sc(3) * 86}%"></span>` : ""}</div>
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
    garis($("g-ind"), { x0: 2014, x1: 2026.4, y0: 50, y1: 85, yt: [50, 60, 70, 80], xt: [2014, 2016, 2018, 2020, 2022, 2024, 2026], tanda: [[T("2022-07"), "Brigadir J"], [T("2025-08"), "Agustus 2025"]],
      seri: [{ nama: "percaya", warna: "--garis-2", bagian: [a.map(r => [T(r[0]), r[1], nm(r[0])]), b.map(r => [T(r[0]), r[1], nm(r[0])])] }],
      label: [[T("2014-04"), 57.6, "atas", 6], [T("2019-02"), 80.5], [T("2022-11"), 60.5, "bawah"], [T("2026-01"), 65]] });
  }
  const PAGAR = [
    ["Tidak untuk menindak pendapat", "Data keluhan tidak boleh menjadi dasar laporan atau penyidikan atas kritik warga.", "Di sini: hanya judul berita publik yang dibaca; tidak ada akun atau unggahan warga."],
    ["Agregat dan anonim", "Dasbor hanya menampilkan jumlah per topik, wilayah, dan waktu.", "Di sini: arsip menyimpan topik, kode wilayah, status, dan jumlah; tanpa nama, judul, atau tautan."],
    ["Masa simpan terbatas", "Data mentah dihapus setelah kasus ditutup.", "Di sini: cache berita dihapus otomatis setelah 4 hari."],
    ["Diawasi pihak luar", "Kompolnas memeriksa catatan pemakaian sistem setiap tahun.", "Di sini: kode dan setiap putaran tercatat terbuka di riwayat GitHub."],
    ["Aturan terbuka", "Daftar topik, ambang status, dan sumber data diumumkan.", "Di sini: semua aturan ada di tab ini dan di config/topik.json."],
  ];
  $("pagar").innerHTML = PAGAR.map(p => `<div class="kartu"><b>${p[0]}</b><p>${p[1]}</p><div class="terapan">✓ ${p[2]}</div></div>`).join("");

  // ------------------------------------------------------------ mulai
  buka(location.hash.slice(1) || "ringkasan");
  gambarSemua();
  muat();
  setInterval(muat, 5 * 60 * 1000);            // ambil ulang data setiap 5 menit
  setInterval(() => { sampul(); }, 60 * 1000);  // perbarui "x menit lalu"
})();
