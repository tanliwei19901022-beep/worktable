#!/usr/bin/env node
'use strict';
/*
 * 每日简报自动生成（供 GitHub Actions 调用）
 * - 行情数字（全球股指 + 大宗商品）从 Yahoo Finance 实时拉取并覆盖
 * - 要闻 / 亚太·欧美板块分析 / 恐慌指数 / 每日总结 沿用 brief.baseline.json（人工补充）
 * - 任何标的拉取失败 -> 保留基线值，绝不中断
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BASELINE = path.join(ROOT, 'brief.baseline.json');
const OUT = path.join(ROOT, 'brief.json');

// 页面 code -> Yahoo symbol
const IDX = {
  usINX: '^GSPC', usNDX: '^NDX', usDJI: '^DJI', deDAX: '^GDAXI',
  jpNI225: '^N225', krKS11: '^KS11', hkHSI: '^HSI', hkHSTECH: '^HSTECH',
  sh000001: '000001.SS', sz399001: '399001.SZ'
};
const CMD = {
  fuGC: 'GC=F', fuCL: 'CL=F', hf_OIL: 'BZ=F', fuSI: 'SI=F',
  fuHG: 'HG=F', fuNG: 'NG=F', iOre: 'TIO=F'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function yahooHosts(sym) {
  const s = encodeURIComponent(sym);
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=5d`
  ];
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return txt;
  } finally {
    clearTimeout(timer);
  }
}

async function getQuote(sym) {
  let lastErr;
  for (const u of yahooHosts(sym)) {
    try {
      const txt = await fetchText(u);
      const j = JSON.parse(txt);
      const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (!m) throw new Error('no meta');
      const price = m.regularMarketPrice;
      const prev = (m.chartPreviousClose != null) ? m.chartPreviousClose : m.previousClose;
      if (price == null || prev == null || prev === 0) throw new Error('bad price');
      const pct = (price - prev) / prev * 100;
      return { price: +price, pct: +pct.toFixed(2) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('failed');
}

function today() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function refresh(list, map, kind) {
  if (!Array.isArray(list)) return;
  await Promise.all(list.map(async (it) => {
    const y = map[it.c];
    if (!y) return;
    try {
      const q = await getQuote(y);
      it.p = +q.price.toFixed(2);
      it.g = q.pct;
      console.log(`  ✓ ${it.n} (${it.c}): ${it.p}  ${q.pct >= 0 ? '+' : ''}${q.pct}%`);
    } catch (e) {
      console.log(`  · ${it.n} (${it.c}): 保留基线值 (${e.message})`);
    }
  }));
}

async function main() {
  let base;
  try {
    base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch (e) {
    console.error('读取 baseline 失败:', e.message);
    process.exit(1);
  }

  console.log('刷新全球股指…');
  await refresh(base.indices, IDX, 'idx');
  console.log('刷新大宗商品…');
  await refresh(base.commodities, CMD, 'cmd');

  base.date = today();
  fs.writeFileSync(OUT, JSON.stringify(base, null, 2));
  console.log('已写出 brief.json，date =', base.date);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
