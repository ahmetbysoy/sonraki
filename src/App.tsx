import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, Target, BarChart2, Droplet, Activity, Settings, 
  TrendingUp, TrendingDown, AlignJustify, Bell, X, Copy,
  CheckCircle, Play, SlidersHorizontal, AlertTriangle, Crosshair, ListFilter
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/* --- UTILS --- */
const Utils = {
  uuid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  formatPrice: (p: number) => p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toFixed(4),
  formatVol: (v: number) => v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0),
  formatMoney: (v: number) => '$' + (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0)),
  timeAgo: (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? `${s}s önce` : s < 3600 ? `${Math.floor(s/60)}dk önce` : `${Math.floor(s/3600)}sa önce`;
  },
  formatTime: (ts: number) => new Date(ts).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
  ttsQueue: [] as string[],
  isSpeaking: false,
  funnyBuyLines: [
    "Oha, balina girdi! Biri evi arabayı bastı.",
    "Yeşil mum dikiyorlar, sıkı tutunun!",
    "Tahtacı çıldırdı, yukarı sürüyor.",
    "Zengin bir abimiz alış yaptı, maşallah."
  ],
  funnySellLines: [
    "Kaçın kaçın, balina mal boşalttı!",
    "Eyvah, şelale formasyonu yükleniyor.",
    "Biri panik yaptı, fena sattılar.",
    "Kırmızı mum geliyor, kaskları takın."
  ],
  funnyLiqLongLines: [
    "Ah be, longcu kardeşim patladı. Geçmiş olsun.",
    "Kaldıraç adamı çarpar işte böyle.",
    "Birinin ocağına incir ağacı diktiler."
  ],
  funnyLiqShortLines: [
    "Shortçuları terste bıraktılar, mis gibi.",
    "Ayılara acımadılar, roket takıldı!",
    "Ayı avı başladı, shortlar gümledi."
  ],
  playNextVoice: function() {
    if (this.ttsQueue.length === 0) { this.isSpeaking = false; return; }
    this.isSpeaking = true;
    const text = this.ttsQueue.shift();
    if (!text) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1.1;
    utterance.pitch = 1.2;
    
    utterance.onend = () => { this.playNextVoice(); };
    utterance.onerror = () => { this.playNextVoice(); };
    window.speechSynthesis.speak(utterance);
  },
  queueVoice: function(text: string, enabled: boolean) {
    if (!enabled) return;
    this.ttsQueue.push(text);
    if (!this.isSpeaking) this.playNextVoice();
  },
  playAlert: (type: 'signal'|'whale', enabled: boolean) => {
    if(!enabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if(!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if(type === 'whale') {
         osc.type = 'sine';
         osc.frequency.setValueAtTime(800, ctx.currentTime);
         gain.gain.setValueAtTime(0.05, ctx.currentTime);
         gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
         osc.start(); osc.stop(ctx.currentTime + 0.5);
      } else {
         osc.type = 'triangle';
         osc.frequency.setValueAtTime(523.25, ctx.currentTime);
         osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
         gain.gain.setValueAtTime(0.1, ctx.currentTime);
         gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
         osc.start(); osc.stop(ctx.currentTime + 0.4);
      }
    } catch(e) {}
  },
  rsi: (prices: number[], period=14) => {
    if(prices.length <= period) return 50;
    let gains = 0, losses = 0;
    for(let i = prices.length - period; i < prices.length; i++) {
      const d = prices[i] - prices[i-1];
      if(d > 0) gains += d; else losses += Math.abs(d);
    }
    const rs = (gains/period) / (losses/period);
    return isNaN(rs) ? 50 : 100 - (100 / (1 + rs));
  },
  ema: (prices: number[], period: number) => {
    if(prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a,b)=>a+b,0) / period;
    for(let i=period; i<prices.length; i++) { ema = prices[i] * k + ema * (1 - k); }
    return ema;
  },
  zScore: (val: number, arr: number[]) => {
    if(arr.length < 2) return 0;
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    const variance = arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/arr.length;
    const std = Math.sqrt(variance);
    return std === 0 ? 0 : (val - mean) / std;
  }
};

/* --- ENGINES --- */
const PROFILES: Record<string, any> = {
  SCALP: { minConf: 60, hold: '1-5m', rr: 1.5, tp: [0.8, 1.5], sl: 0.6, weight: { tech:0.4, cascade:0.2, whale:0.2, mtf:0.2 } },
  SWING: { minConf: 65, hold: '30m-4h', rr: 1.8, tp: [2.5, 5.0], sl: 1.5, weight: { tech:0.3, cascade:0.15, whale:0.25, mtf:0.3 } },
  SAFE: { minConf: 82, hold: '5-30m', rr: 2.0, tp: [1.2, 2.5], sl: 0.8, weight: { tech:0.25, cascade:0.2, whale:0.25, mtf:0.3 } },
  AGGRESSIVE: { minConf: 45, hold: '1-5m', rr: 1.2, tp: [1.5, 3.0], sl: 1.0, weight: { tech:0.45, cascade:0.3, whale:0.15, mtf:0.1 } },
  WHALE: { minConf: 55, hold: '5-30m', rr: 1.5, tp: [1.5, 3.5], sl: 1.2, weight: { tech:0.2, cascade:0.2, whale:0.45, mtf:0.15 } }
};

export default function App() {
  const [isEngineRunning, setIsEngineRunning] = useState(true);
  const [activeTab, setActiveTab] = useState('market'); // Default to market to see the flow
  const [wsStatus, setWsStatus] = useState('connecting');
  const [ticker, setTicker] = useState({ price: 0, vol: 0, change: 0, trades: 0 });
  const [signals, setSignals] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [liqs, setLiqs] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  
  const [depth, setDepth] = useState({ bidVol: 0, askVol: 0, maxBid: {p:0,v:0}, maxAsk: {p:0,v:0} });

  const [stats, setStats] = useState({
    rsi: 50, ema9: 0, ema21: 0, z: 0, 
    buyVol: 0, sellVol: 0, tradeCount: 0,
    liqTotal: 0, liqLong: 0, liqShort: 0
  });

  const [liqFilter, setLiqFilter] = useState('all');

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('liveflow_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.shakeEnabled === undefined) parsed.shakeEnabled = true;
        if (parsed.liqSymbolFilter === undefined) parsed.liqSymbolFilter = '';
        if (parsed.liqMinUsd === undefined) parsed.liqMinUsd = 0;
        if (parsed.liqMaxUsd === undefined) parsed.liqMaxUsd = 0;
        return parsed;
      } catch(e) {}
    }
    return {
      symbol: 'BTCUSDT',
      profile: 'SCALP',
      minConf: 70,
      minTradeUsd: 1000,
      whaleThresh: 50000,
      maxListItems: 50,
      sound: false,
      showBuys: true,
      showSells: true,
      shakeEnabled: true,
      liqSymbolFilter: '',
      liqMinUsd: 0,
      liqMaxUsd: 0
    };
  });

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem('liveflow_settings', JSON.stringify(settings));
  }, [settings]);

  const [isShaking, setIsShaking] = useState(false);
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400);
  }, []);

  const engineRef = useRef({
    prices: [] as number[],
    volumes: [] as number[],
    recentLiqs: [] as {side:string, amount:number, price:number, ts:number}[],
    buyVol: 0, sellVol: 0, tradeCount: 0,
    liqTotal: 0, liqLong: 0, liqShort: 0,
    lastSignal: 0, tickCount: 0
  });

  // Signal Tracking Effect
  useEffect(() => {
    if (ticker.price === 0) return;
    const p = ticker.price;
    setHistory(prev => {
      let changed = false;
      const updated = prev.map(sig => {
        if (sig.result !== 'PENDING') return sig;
        
        // Timeout check (e.g. if > 1 hour, mark as closed/expired? for now just check result)
        // Or check active status based on time.
        
        if (sig.direction === 'LONG') {
          if (p >= sig.tp1) { changed = true; return { ...sig, result: 'WIN' }; }
          if (p <= sig.sl) { changed = true; return { ...sig, result: 'LOSS' }; }
        } else {
          if (p <= sig.tp1) { changed = true; return { ...sig, result: 'WIN' }; }
          if (p >= sig.sl) { changed = true; return { ...sig, result: 'LOSS' }; }
        }
        return sig;
      });
      return changed ? updated : prev;
    });
  }, [ticker.price]);

  useEffect(() => {
    setTicker({ price: 0, vol: 0, change: 0, trades: 0 });
    setSignals([]);
    setTrades([]);
    setLiqs([]);
    setHistory([]);
  }, [settings.symbol]);

  useEffect(() => {
    let ws: WebSocket;
    let updateInterval: any;

    const connect = () => {
      setWsStatus('connecting');
      const sym = settings.symbol.toLowerCase();
      // Reset engine state explicitly on connection
      engineRef.current = {
        prices: [],
        volumes: [],
        recentLiqs: [],
        buyVol: 0,
        sellVol: 0,
        tradeCount: 0,
        liqTotal: 0,
        liqLong: 0,
        liqShort: 0,
        lastSignal: 0,
        tickCount: 0
      };
      
      ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${sym}@aggTrade/!forceOrder@arr/${sym}@ticker/${sym}@depth20@100ms`);
      
      ws.onopen = () => {
        setWsStatus('connected');
      };
      
      ws.onclose = () => {
        setWsStatus('disconnected');
        // Only reconnect if still running and not intentionally closed
        if (isEngineRunning && !isClosed) setTimeout(connect, 3000);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const data = msg.data;
        if (!data) return;

        if (data.e === '24hrTicker' || msg.stream.includes('@ticker')) {
          setTicker(prev => ({
            ...prev,
            price: parseFloat(data.c),
            change: parseFloat(data.P),
            vol: parseFloat(data.v)
          }));
        }

        // We only handle depth and tickers without running block if we want UI to reflect. 
        // Or we can block everything. Let's block Trades and Liqs.

        if (data.e === 'depthUpdate' || msg.stream.includes('@depth')) {
           if (!isEngineRunning) return;
           const bids = data.b || [];
           const asks = data.a || [];
           let bVol=0, aVol=0;
           let mB = {p:0, v:0}, mA = {p:0, v:0};
           for(let i=0; i<bids.length; i++) { 
             const p = parseFloat(bids[i][0]); const q = parseFloat(bids[i][1]); const v = p*q; 
             bVol+=v; if(v>mB.v){ mB.p=p; mB.v=v; } 
           }
           for(let i=0; i<asks.length; i++) { 
             const p = parseFloat(asks[i][0]); const q = parseFloat(asks[i][1]); const v = p*q; 
             aVol+=v; if(v>mA.v){ mA.p=p; mA.v=v; } 
           }
           setDepth({ bidVol: bVol, askVol: aVol, maxBid: mB, maxAsk: mA });
        }

        if (data.e === 'forceOrder' || msg.stream.includes('@forceOrder')) {
          if (!isEngineRunning) return;
          const o = data.o || data;
          const liqAmount = parseFloat(o.q) * parseFloat(o.p);
          const side = o.S === 'BUY' ? 'SHORT' : 'LONG';
          
          let sizeClass = 'small';
          if (liqAmount >= settingsRef.current.whaleThresh) sizeClass = 'whale';
          else if (liqAmount >= 10000) sizeClass = 'mid';

          const liqItem = {
            id: Utils.uuid(), symbol: o.s || 'UNKNOWN', side,
            amount: liqAmount, price: parseFloat(o.p), 
            ts: Date.now(), sizeClass
          };

          const lines = side === 'LONG' ? Utils.funnyLiqLongLines : Utils.funnyLiqShortLines;
          Utils.queueVoice(lines[Math.floor(Math.random() * lines.length)], settingsRef.current.sound);
          if (settingsRef.current.shakeEnabled) triggerShake();
          
          setLiqs(prev => [liqItem, ...prev].slice(0, settingsRef.current.maxListItems));
          
          engineRef.current.liqTotal++;
          if(side === 'LONG') engineRef.current.liqLong += liqAmount;
          else engineRef.current.liqShort += liqAmount;
          
          engineRef.current.recentLiqs.push({ side, amount: liqAmount, price: parseFloat(o.p), ts: Date.now() });
        }

        if (data.e === 'aggTrade' || msg.stream.includes('@aggTrade')) {
          if (!isEngineRunning) return;
          const p = parseFloat(data.p);
          const q = parseFloat(data.q);
          const v = p * q;
          const isBuy = !data.m;
          
          engineRef.current.prices.push(p);
          engineRef.current.volumes.push(v);
          if(engineRef.current.prices.length > 50) {
            engineRef.current.prices.shift();
            engineRef.current.volumes.shift();
          }

          engineRef.current.tradeCount++;
          if(isBuy) engineRef.current.buyVol += v;
          else engineRef.current.sellVol += v;

          // Order Flow Filter
          if(v >= settingsRef.current.minTradeUsd) {
             if ((isBuy && !settingsRef.current.showBuys) || (!isBuy && !settingsRef.current.showSells)) return;

             const isWhale = v >= settingsRef.current.whaleThresh;
             if(isWhale) {
               Utils.playAlert('whale', settingsRef.current.sound);
               const lines = isBuy ? Utils.funnyBuyLines : Utils.funnySellLines;
               Utils.queueVoice(lines[Math.floor(Math.random() * lines.length)], settingsRef.current.sound);
               if (settingsRef.current.shakeEnabled) triggerShake();
             }
             const tradeItem = {
               id: Utils.uuid(), p, q, v, isBuy, isWhale, ts: Date.now(), flash: true
             };
             setTrades(prev => [tradeItem, ...prev].slice(0, settingsRef.current.maxListItems));
          }

          // Evaluate Active Signals Check
          setHistory(prev => {
             let changed = false;
             const updated = prev.map(sig => {
               if (sig.result) return sig;
               if (sig.direction === 'LONG') {
                 if (p >= sig.tp1) { changed = true; return { ...sig, result: 'WIN' }; }
                 if (p <= sig.sl) { changed = true; return { ...sig, result: 'LOSS' }; }
               } else {
                 if (p <= sig.tp1) { changed = true; return { ...sig, result: 'WIN' }; }
                 if (p >= sig.sl) { changed = true; return { ...sig, result: 'LOSS' }; }
               }
               return sig;
             });
             return changed ? updated : prev;
          });

          engineRef.current.tickCount++;
          if(engineRef.current.tickCount % 20 === 0 && engineRef.current.prices.length >= 21) {
             const now = Date.now();
             if(now - engineRef.current.lastSignal > 10000) {
                const pr = engineRef.current.prices;
                const rsiVal = Utils.rsi(pr);
                const ema9 = Utils.ema(pr, 9) || pr[pr.length-1];
                const ema21 = Utils.ema(pr, 21) || pr[pr.length-1];
                const zVal = Utils.zScore(pr[pr.length-1], pr.slice(-20));
                
                // 1. Technical Score
                let techScore = 0;
                let techTriggers = [];
                if (rsiVal < 30) { techScore += 15; techTriggers.push('RSI_OVERSOLD'); }
                else if (rsiVal > 70) { techScore -= 15; techTriggers.push('RSI_OVERBOUGHT'); }
                if (zVal < -2) { techScore += 12; techTriggers.push('Z_SCORE_LOW'); }
                else if (zVal > 2) { techScore -= 12; techTriggers.push('Z_SCORE_HIGH'); }
                if (ema9 > ema21) { techScore += 10; techTriggers.push('EMA_BULL'); }
                else { techScore -= 10; techTriggers.push('EMA_BEAR'); }

                // 2. Cascade Detection
                engineRef.current.recentLiqs = engineRef.current.recentLiqs.filter(l => now - l.ts < 30000);
                const recentLiqs = engineRef.current.recentLiqs;
                const longLiqs = recentLiqs.filter(l => l.side === 'LONG');
                const shortLiqs = recentLiqs.filter(l => l.side === 'SHORT');
                
                let cascadeScore = 0;
                let cascadeTrigger = null;
                if (longLiqs.length >= 3 && longLiqs.reduce((acc, curr) => acc + curr.amount, 0) > 500000) {
                  cascadeScore -= 25; // Longs cascaded -> Price crashing -> Momentum bearish
                  cascadeTrigger = 'LONG_CASCADE';
                } else if (shortLiqs.length >= 3 && shortLiqs.reduce((acc, curr) => acc + curr.amount, 0) > 500000) {
                  cascadeScore += 25; // Shorts cascaded -> Price rocketing -> Momentum bullish
                  cascadeTrigger = 'SHORT_CASCADE';
                }

                // 3. Whale Flow Analysis
                const wBuy = engineRef.current.buyVol;
                const wSell = engineRef.current.sellVol;
                const totalFlow = wBuy + wSell;
                let whaleScore = 0;
                let whaleTrigger = null;
                if (totalFlow > 0) {
                   const imbalance = (wBuy - wSell) / totalFlow;
                   if (imbalance > 0.3) { whaleScore += 20; whaleTrigger = 'WHALE_ACCUMULATION'; }
                   else if (imbalance < -0.3) { whaleScore -= 20; whaleTrigger = 'WHALE_DISTRIBUTION'; }
                }

                // 4. MTF Context (Simulated via local EMA)
                const mtfScore = ema9 > ema21 ? 15 : -15;

                // 5. Profiling & Final Score
                const profSpec = PROFILES[settingsRef.current.profile as keyof typeof PROFILES];
                const weight = profSpec.weight || { tech:0.3, cascade:0.2, whale:0.3, mtf:0.2 };
                
                const totalScore = (techScore * weight.tech) + (cascadeScore * weight.cascade) + (whaleScore * weight.whale) + (mtfScore * weight.mtf);
                
                const dir = totalScore > 5 ? 'LONG' : (totalScore < -5 ? 'SHORT' : 'WAIT');
                const rawConf = Math.min(98, Math.max(45, 50 + Math.abs(totalScore) * 1.2));
                const conf = Math.round(rawConf);

                if (dir !== 'WAIT' && conf >= settingsRef.current.minConf) {
                  const triggers = [...techTriggers.slice(0, 1), cascadeTrigger, whaleTrigger].filter(Boolean).join(' + ') || 'COMBO';
                  
                  const entry = p;
                  const dist = entry * (profSpec.sl / 100);
                  const sl = dir === 'LONG' ? entry - dist : entry + dist;
                  const tp1 = dir === 'LONG' ? entry + (dist*profSpec.tp[0]) : entry - (dist*profSpec.tp[0]);
                  const tp2 = dir === 'LONG' ? entry + (dist*profSpec.tp[1]) : entry - (dist*profSpec.tp[1]);

                  const sig = {
                    id: Utils.uuid(), symbol: settingsRef.current.symbol, direction: dir, confidence: conf,
                    category: settingsRef.current.profile, trigger: triggers,
                    entry, sl, tp1, tp2, rr: profSpec.rr, ts: now, result: 'PENDING'
                  };
                  
                  Utils.playAlert('signal', settingsRef.current.sound);
                  setSignals(prev => [sig, ...prev].slice(0, 20));
                  setHistory(prev => [sig, ...prev]);
                  engineRef.current.lastSignal = now;
                }
             }
          }
        }
      };
    };

    connect();

    updateInterval = setInterval(() => {
      const pr = engineRef.current.prices;
      if(pr.length >= 21) {
        setStats({
          rsi: Utils.rsi(pr),
          ema9: Utils.ema(pr, 9) || 0,
          ema21: Utils.ema(pr, 21) || 0,
          z: Utils.zScore(pr[pr.length-1], pr.slice(-20)),
          buyVol: engineRef.current.buyVol,
          sellVol: engineRef.current.sellVol,
          tradeCount: engineRef.current.tradeCount,
          liqTotal: engineRef.current.liqTotal,
          liqLong: engineRef.current.liqLong,
          liqShort: engineRef.current.liqShort
        });
      }
    }, 1000);

    return () => {
      if(ws) {
        ws.onclose = null;
        ws.close();
      }
      clearInterval(updateInterval);
    };
  }, [settings.symbol, isEngineRunning]);

  const TABS = [
    { id: 'market', label: 'Piyasa', icon: <BarChart2 size={20} /> },
    { id: 'liquidations', label: 'Likit', icon: <Droplet size={20} /> },
    { id: 'heatmap', label: 'Isı Haritası', icon: <TrendingUp size={20} /> },
    { id: 'signals', label: 'Sinyaller', icon: <Target size={20} /> },
    { id: 'performance', label: 'Analiz', icon: <Activity size={20} /> },
    { id: 'settings', label: 'Ayarlar', icon: <Settings size={20} /> }
  ];

  /* UI Math for Session Volume Bar */
  const totalSessionVol = stats.buyVol + stats.sellVol;
  const buyPct = totalSessionVol > 0 ? (stats.buyVol / totalSessionVol) * 100 : 50;
  const sellPct = totalSessionVol > 0 ? (stats.sellVol / totalSessionVol) * 100 : 50;

  return (
    <div className={`h-[100dvh] bg-green-50/50 text-slate-800 font-sans selection:bg-teal-200 overflow-hidden ${isShaking ? 'animate-shake' : ''}`}>
      
      {/* Toast Overlay (Hidden by default, you can trigger via state) */}
      <div id="toast" className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl opacity-0 transition-opacity z-[100] pointer-events-none">
        ✓ Ayarlar Kaydedildi
      </div>

      <div className="max-w-md mx-auto h-full bg-emerald-50/30 shadow-2xl border-x border-emerald-100/50 relative flex flex-col">
        
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-emerald-100 px-4 py-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200/50">
                  <Zap size={18} className="fill-current" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                     <input
                       type="text"
                       className="w-16 px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-[10px] font-extrabold text-emerald-800 uppercase"
                       value={settings.symbol.replace('USDT', '')}
                       onChange={(e) => setSettings(prev => ({ ...prev, symbol: e.target.value.toUpperCase() + 'USDT' }))}
                     />
                     <button 
                      onClick={() => setIsEngineRunning(!isEngineRunning)}
                      className={`text-[9px] px-2 py-0.5 rounded shadow-sm text-white font-extrabold transition-colors ${isEngineRunning ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
                    >
                      {isEngineRunning ? '⏸ DURDUR' : '▶ BAŞLAT'}
                    </button>
                  </div>
                  <h1 className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-700 to-teal-600 text-xs leading-tight">
                    LiveFlow Pro
                  </h1>
                </div>
             </div>
             <div className="flex gap-2 text-xs">
                {signals.length > 0 && (
                  <span className="flex items-center gap-1 bg-pink-100 text-pink-600 font-bold px-2.5 py-1 rounded-full border border-pink-200 animate-pulse shadow-sm shadow-pink-100">
                    <Target size={12}/> SIGNAL
                  </span>
                )}
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border shadow-sm ${wsStatus === 'connected' ? 'bg-emerald-100 text-emerald-600 border-emerald-200 shadow-emerald-100' : 'bg-rose-100 text-rose-600 border-rose-200'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                  {wsStatus === 'connected' ? 'Canlı' : 'Koptu'}
                </span>
             </div>
          </div>
          
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-indigo-50/80 border border-indigo-100/80 rounded-xl p-2 text-center">
              <div className="text-[9px] text-indigo-400 font-extrabold tracking-widest uppercase">Fiyat</div>
              <div className="text-xs font-bold text-indigo-700 font-mono mt-0.5">${Utils.formatPrice(ticker.price)}</div>
            </div>
            <div className="bg-fuchsia-50/80 border border-fuchsia-100/80 rounded-xl p-2 text-center">
              <div className="text-[9px] text-fuchsia-400 font-extrabold tracking-widest uppercase">24s Hacim</div>
              <div className="text-xs font-bold text-fuchsia-700 font-mono mt-0.5">{Utils.formatVol(ticker.vol)}</div>
            </div>
            <div className="bg-rose-50/80 border border-rose-100/80 rounded-xl p-2 text-center">
              <div className="text-[9px] text-rose-400 font-extrabold tracking-widest uppercase">Sinyal</div>
              <div className="text-xs font-bold text-rose-700 font-mono mt-0.5">{history.length}</div>
            </div>
            <div className="bg-emerald-50/80 border border-emerald-100/80 rounded-xl p-2 text-center">
              <div className="text-[9px] text-emerald-400 font-extrabold tracking-widest uppercase">Başarı</div>
              <div className="text-xs font-bold text-emerald-700 font-mono mt-0.5">
                {(() => {
                  const resolved = history.filter(h => h.result);
                  const total = resolved.length;
                  const won = resolved.filter(h => h.result === 'WIN').length;
                  return total > 0 ? `${((won / total) * 100).toFixed(0)}%` : '--';
                })()}
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col hide-scrollbar">
          
          {activeTab === 'heatmap' && (
            <div className="flex flex-col gap-4 p-4 h-full">
              <div className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 uppercase mb-4">Likidasyon Yoğunluk Haritası</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(() => {
                        const currentPrice = ticker.price || 0;
                        if(currentPrice === 0) return Array.from({length: 20}, (_,i) => ({price: 0, volume: 0}));
                        const range = currentPrice * 0.01; // 1% range
                        const bucketSize = range / 20;
                        const buckets = Array.from({length: 20}, (_, i) => ({
                          price: (currentPrice - range/2 + i * bucketSize).toFixed(2),
                          volume: 0
                        }));
                        engineRef.current.recentLiqs.forEach(l => {
                          const diff = l.price - (currentPrice - range/2);
                          const bucketIdx = Math.floor(diff / bucketSize);
                          if (bucketIdx >=0 && bucketIdx < 20) buckets[bucketIdx].volume += l.amount;
                        });
                        return buckets;
                      })()}>
                      <XAxis dataKey="price" hide />
                      <YAxis hide />
                      <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '12px', fontSize: '10px', padding: '6px'}}/>
                      <Bar dataKey="volume">
                        {Array.from({length: 20}, (_, i) => (
                           <Cell key={i} fill={i < 10 ? '#f43f5e' : '#10b981'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-center font-bold text-slate-400 mt-2">Düşük Fiyat ◄─────── Fiyat ───────► Yüksek Fiyat</div>
              </div>
            </div>
          )}

          {/* SIGNALS TAB */}
          {activeTab === 'signals' && (
             <div className="space-y-3">
               {signals.length === 0 ? (
                 <div className="bg-white/60 border border-emerald-100 rounded-2xl p-8 text-center border-dashed">
                   <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-emerald-50">
                      <Crosshair size={24} className="text-emerald-300" />
                   </div>
                   <h3 className="text-emerald-700 font-bold mb-1 text-sm bg-emerald-50/50 inline-block px-3 py-1 rounded-lg">Sinyal Bekleniyor</h3>
                   <p className="text-[11px] text-emerald-600/60 mt-2">Hybrid Engine {settings.profile} kurulumu arıyor...</p>
                 </div>
               ) : (
                 signals.map(sig => (
                   <div key={sig.id} className={`rounded-2xl p-4 border shadow-sm relative overflow-hidden ${
                     sig.direction === 'LONG' 
                      ? 'bg-gradient-to-br from-emerald-50/80 to-teal-50/80 border-emerald-200' 
                      : 'bg-gradient-to-br from-rose-50/80 to-orange-50/80 border-rose-200'
                   }`}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${
                            sig.direction === 'LONG' ? 'bg-white text-emerald-600 border-emerald-200' : 'bg-white text-rose-600 border-rose-200'
                          }`}>
                            {sig.direction === 'LONG' ? '🚀 LONG' : '📉 SHORT'}
                          </span>
                          <span className="font-extrabold text-sm text-slate-700">{sig.symbol}</span>
                          <span className="bg-white/80 text-slate-500 text-[9px] font-bold px-2 py-0.5 rounded border border-slate-200/50">
                            {sig.category}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">{Utils.timeAgo(sig.ts)}</span>
                      </div>

                      <div className="bg-white/60 rounded-xl p-3 border border-white mb-3 shadow-sm">
                         <div className="flex justify-between text-[11px] mb-1.5">
                           <span className="text-slate-500 font-bold">Güven Skoru</span>
                           <span className={`font-bold font-mono ${sig.confidence >= 80 ? 'text-emerald-500' : 'text-amber-500'}`}>%{sig.confidence}</span>
                         </div>
                         <div className="h-1.5 bg-slate-200/50 rounded-full overflow-hidden mb-2">
                           <div className={`h-full rounded-full ${sig.confidence >= 80 ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : 'bg-gradient-to-r from-amber-400 to-orange-400'}`} style={{ width: `${sig.confidence}%` }}></div>
                         </div>
                         <div className="flex justify-between text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mt-2 border-t border-slate-200/50 pt-2">
                           <span>MANTIK</span>
                           <span className="text-indigo-500 max-w-[150px] truncate" title={sig.trigger}>{sig.trigger}</span>
                         </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-white/80 rounded-xl p-2 text-center border border-white shadow-sm">
                          <div className="text-[9px] text-slate-400 uppercase font-extrabold tracking-wider mb-1">Giriş</div>
                          <div className="text-xs font-bold font-mono text-slate-700">{Utils.formatPrice(sig.entry)}</div>
                        </div>
                        <div className="bg-white/80 rounded-xl p-2 text-center border border-white shadow-sm">
                          <div className="text-[9px] text-rose-400 uppercase font-extrabold tracking-wider mb-1">Stop</div>
                          <div className="text-xs font-bold font-mono text-rose-600">{Utils.formatPrice(sig.sl)}</div>
                        </div>
                        <div className="bg-white/80 rounded-xl p-2 text-center border border-white shadow-sm">
                          <div className="text-[9px] text-emerald-400 uppercase font-extrabold tracking-wider mb-1">Hedef</div>
                          <div className="text-xs font-bold font-mono text-emerald-600">{Utils.formatPrice(sig.tp1)}</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                         <button onClick={() => setSignals(s => s.filter(x => x.id !== sig.id))} className="flex-1 bg-white hover:bg-slate-50 text-slate-500 text-xs py-2 rounded-xl border border-slate-200/60 font-bold shadow-sm transition-colors">
                           Kapat
                         </button>
                         <button className={`flex-1 text-white text-xs py-2 rounded-xl font-bold shadow-sm flex justify-center items-center gap-1.5 transition-transform active:scale-95 ${
                           sig.direction === 'LONG' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200' : 'bg-rose-500 hover:bg-rose-600 shadow-rose-200'
                         }`}>
                           <Copy size={14} /> Kopyala
                         </button>
                      </div>
                   </div>
                 ))
               )}
             </div>
          )}

          {/* MARKET & FLOW TAB */}
          {activeTab === 'market' && (
            <div className="flex flex-col gap-3 py-1">
              
              {/* Upper: Session Volume Bar */}
              <div className="bg-white border border-emerald-100 p-3.5 rounded-2xl shadow-sm shrink-0">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                     <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                     </span>
                     Seans Akışı
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">{stats.tradeCount} İşlem</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all duration-300" style={{ width: `${buyPct}%`}}></div>
                  <div className="h-full bg-gradient-to-l from-rose-400 to-orange-400 transition-all duration-300" style={{ width: `${sellPct}%`}}></div>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mt-2 font-mono">
                  <span className="text-emerald-600">▲ AL %{buyPct.toFixed(0)} <span className="text-slate-400 font-sans font-medium text-[9px]">(${Utils.formatVol(stats.buyVol)})</span></span>
                  <span className="text-rose-600"><span className="text-slate-400 font-sans font-medium text-[9px]">(${Utils.formatVol(stats.sellVol)})</span> %{sellPct.toFixed(0)} SAT ▼</span>
                </div>
              </div>

              {/* Order Book / Emir Duvarı (Top 20) */}
              <div className="bg-white border border-emerald-100 p-3 rounded-2xl shadow-sm shrink-0">
                 <div className="flex justify-between items-center mb-2">
                   <h2 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                     <ListFilter size={12}/> Emir Duvarı <span className="text-[8px] bg-emerald-50 text-emerald-500 px-1 py-0.5 rounded ml-1">Derinlik 20</span>
                   </h2>
                 </div>
                 {/* Bid/Ask Volume Bar */}
                 <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex mb-2">
                   <div className="h-full bg-emerald-400" style={{ width: `${depth.bidVol + depth.askVol > 0 ? (depth.bidVol / (depth.bidVol + depth.askVol))*100 : 50}%`}}></div>
                   <div className="h-full bg-rose-400" style={{ width: `${depth.bidVol + depth.askVol > 0 ? (depth.askVol / (depth.bidVol + depth.askVol))*100 : 50}%`}}></div>
                 </div>
                 {/* Max Walls */}
                 <div className="flex justify-between gap-2">
                    <div className="flex-1 bg-emerald-50/50 border border-emerald-100/50 rounded-lg p-1.5">
                      <div className="text-[9px] text-emerald-600/70 font-extrabold mb-0.5">ALICI DUVARI</div>
                      <div className="text-[10px] font-bold font-mono text-emerald-700">${Utils.formatPrice(depth.maxBid.p)}</div>
                      <div className="text-[8px] text-slate-400 font-mono">Vol: ${Utils.formatVol(depth.maxBid.v)}</div>
                    </div>
                    <div className="flex-1 bg-rose-50/50 border border-rose-100/50 rounded-lg p-1.5 text-right">
                      <div className="text-[9px] text-rose-600/70 font-extrabold mb-0.5">SATICI DUVARI</div>
                      <div className="text-[10px] font-bold font-mono text-rose-700">${Utils.formatPrice(depth.maxAsk.p)}</div>
                      <div className="text-[8px] text-slate-400 font-mono">Vol: ${Utils.formatVol(depth.maxAsk.v)}</div>
                    </div>
                 </div>
              </div>

              {/* Middle: Indicators */}
              <div className="grid grid-cols-3 gap-2 shrink-0">
                <div className="bg-white border border-emerald-100 p-2.5 rounded-xl shadow-sm flex flex-col items-center justify-center">
                   <div className="text-[9px] text-slate-400 uppercase font-extrabold mb-0.5">RSI 14</div>
                   <div className={`text-sm font-bold font-mono ${stats.rsi > 65 ? 'text-rose-500' : stats.rsi < 35 ? 'text-emerald-500' : 'text-slate-700'}`}>{stats.rsi.toFixed(1)}</div>
                </div>
                <div className="bg-white border border-emerald-100 p-2.5 rounded-xl shadow-sm flex flex-col items-center justify-center">
                   <div className="text-[9px] text-slate-400 uppercase font-extrabold mb-0.5">Z-Score</div>
                   <div className={`text-sm font-bold font-mono ${Math.abs(stats.z) > 1.5 ? (stats.z > 0 ? 'text-rose-500' : 'text-emerald-500') : 'text-slate-700'}`}>{stats.z > 0 ? '+' : ''}{stats.z.toFixed(2)}</div>
                </div>
                <div className="bg-white border border-emerald-100 p-2.5 rounded-xl shadow-sm flex flex-col items-center justify-center">
                   <div className="text-[9px] text-slate-400 uppercase font-extrabold mb-0.5">EMA Trend</div>
                   <div className={`text-xs font-bold uppercase mt-0.5 ${stats.ema9 > stats.ema21 ? 'text-emerald-500' : 'text-rose-500'}`}>{stats.ema9 > stats.ema21 ? 'Bull' : 'Bear'}</div>
                </div>
              </div>

              {/* Lower: Live Order Flow List */}
              <div className="bg-white border border-emerald-100 rounded-2xl shadow-sm mt-1 pb-2">
                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-50 bg-slate-50/50 rounded-t-2xl">
                  <h2 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                    Canlı İşlemler 
                    <span className="text-[9px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1.5 py-0.5 rounded font-bold lowercase opacity-80">
                      &gt;${Utils.formatVol(settings.minTradeUsd)}
                    </span>
                  </h2>
                </div>
                
                <div className="px-2 py-2 space-y-1">
                  {trades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 opacity-60">
                      <Activity size={24} className="mb-2" />
                      <p className="text-[10px] font-bold">Filtreye uygun işlem bekleniyor...</p>
                    </div>
                  ) : (
                    trades.map(t => (
                      <div key={t.id} className={`flex justify-between items-center px-3 py-2 rounded-xl border border-slate-50 hover:border-slate-100 transition-colors ${t.flash ? (t.isBuy ? 'flash-buy' : 'flash-sell') : ''} bg-white`} onAnimationEnd={() => t.flash = false}>
                        <div className="flex flex-col gap-0.5">
                          <div className={`text-[10px] items-center flex gap-1.5 font-extrabold ${t.isBuy ? 'text-emerald-500' : 'text-rose-500'}`}>
                             <div className={`w-1.5 h-1.5 rounded-full ${t.isBuy ? 'bg-emerald-400' : 'bg-rose-400'}`}></div>
                             {t.isBuy ? 'AL' : 'SAT'}
                          </div>
                          <div className="text-[9px] text-slate-400 font-mono">{Utils.formatTime(t.ts)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 relative">
                          <div className="text-[11px] font-bold font-mono text-slate-700">${Utils.formatPrice(t.p)}</div>
                          <div className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md ${t.isWhale ? 'bg-fuchsia-100 text-fuchsia-600 border border-fuchsia-200' : 'text-slate-500 bg-slate-50 border border-slate-100'}`}>
                            {t.isWhale && '🐳 '}${Utils.formatVol(t.v)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

          {/* LIQUIDATIONS TAB */}
          {activeTab === 'liquidations' && (
             <div className="flex flex-col h-full gap-3">
               <div className="grid grid-cols-3 gap-2 shrink-0">
                 <div className="bg-white border border-emerald-100 p-2.5 rounded-xl text-center shadow-sm">
                   <div className="text-[9px] text-slate-400 uppercase font-extrabold">Olay</div>
                   <div className="text-sm font-bold font-mono text-slate-700">{stats.liqTotal}</div>
                 </div>
                 <div className="bg-rose-50/80 border border-rose-100/80 p-2.5 rounded-xl text-center shadow-sm">
                   <div className="text-[9px] text-rose-400 uppercase font-extrabold">Long Liq</div>
                   <div className="text-sm font-bold font-mono text-rose-600">${Utils.formatVol(stats.liqLong)}</div>
                 </div>
                 <div className="bg-emerald-50/80 border border-emerald-100/80 p-2.5 rounded-xl text-center shadow-sm">
                   <div className="text-[9px] text-emerald-400 uppercase font-extrabold">Short Liq</div>
                   <div className="text-sm font-bold font-mono text-emerald-600">${Utils.formatVol(stats.liqShort)}</div>
                 </div>
               </div>

               <div className="flex-1 flex flex-col bg-white border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
                 <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/50 shrink-0">
                   <div className="flex justify-between items-center mb-3">
                     <h2 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-widest">Akış Haritası</h2>
                     <button onClick={() => {setLiqs([]); engineRef.current.liqTotal = 0; engineRef.current.liqLong = 0; engineRef.current.liqShort = 0; setStats(s => ({...s, liqTotal: 0, liqLong: 0, liqShort: 0}))}} className="text-[10px] bg-white border border-slate-200 text-slate-500 px-2 py-1 flex items-center justify-center rounded-lg shadow-sm font-bold active:scale-95 transition-transform"><X size={12} className="mr-1"/> Temizle</button>
                   </div>
                   
                   <div className="flex gap-1.5 mb-3">
                     <button onClick={() => setLiqFilter('all')} className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all border ${liqFilter === 'all' ? 'bg-purple-100/50 text-purple-600 border-purple-200 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>Tümü</button>
                     <button onClick={() => setLiqFilter('LONG')} className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all border ${liqFilter === 'LONG' ? 'bg-rose-100/50 text-rose-600 border-rose-200 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>📉 Long</button>
                     <button onClick={() => setLiqFilter('SHORT')} className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all border ${liqFilter === 'SHORT' ? 'bg-emerald-100/50 text-emerald-600 border-emerald-200 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>🚀 Short</button>
                     <button onClick={() => setLiqFilter('whale')} className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all border ${liqFilter === 'whale' ? 'bg-pink-100/50 text-pink-600 border-pink-200 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>🐳 Balina</button>
                   </div>

                   <div className="flex gap-2">
                     <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[8px] font-extrabold text-slate-400 uppercase px-1">Coin Arama</label>
                        <input type="text" placeholder="Örn: BTC" value={settings.liqSymbolFilter} onChange={e => setSettings(s => ({...s, liqSymbolFilter: e.target.value}))} className="w-full bg-white border border-emerald-100 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-600 uppercase outline-none focus:border-emerald-300 transition-colors" />
                     </div>
                     <div className="flex-[0.8] flex flex-col gap-1">
                        <label className="text-[8px] font-extrabold text-slate-400 uppercase px-1">Min USD</label>
                        <input type="number" min="0" placeholder="0" value={settings.liqMinUsd || ''} onChange={e => setSettings(s => ({...s, liqMinUsd: parseInt(e.target.value) || 0}))} className="w-full bg-white border border-emerald-100 rounded-lg px-2 py-1 text-[10px] font-bold font-mono text-slate-600 outline-none focus:border-emerald-300 transition-colors" />
                     </div>
                     <div className="flex-[0.8] flex flex-col gap-1">
                        <label className="text-[8px] font-extrabold text-slate-400 uppercase px-1">Max USD</label>
                        <input type="number" min="0" placeholder="Limit Yok" value={settings.liqMaxUsd || ''} onChange={e => setSettings(s => ({...s, liqMaxUsd: parseInt(e.target.value) || 0}))} className="w-full bg-white border border-emerald-100 rounded-lg px-2 py-1 text-[10px] font-bold font-mono text-slate-600 outline-none focus:border-emerald-300 transition-colors" />
                     </div>
                   </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 hide-scrollbar">
                   {liqs.length === 0 ? (
                     <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                       <Droplet size={24} className="mb-2" />
                       <p className="text-[10px] font-bold">Likidasyon Bekleniyor...</p>
                     </div>
                   ) : (
                     liqs.filter(l => {
                       const matchTab = liqFilter === 'all' || (liqFilter === 'LONG' || liqFilter === 'SHORT' ? l.side === liqFilter : l.sizeClass === 'whale');
                       const matchSym = !settings.liqSymbolFilter || l.symbol.toUpperCase().includes(settings.liqSymbolFilter.toUpperCase());
                       const matchMin = !settings.liqMinUsd || l.amount >= settings.liqMinUsd;
                       const matchMax = !settings.liqMaxUsd || l.amount <= settings.liqMaxUsd;
                       return matchTab && matchSym && matchMin && matchMax;
                     }).map(l => (
                       <div key={l.id} className="relative overflow-hidden bg-white border border-slate-100 p-3 rounded-xl shadow-sm flex flex-col gap-2">
                         <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${l.side === 'LONG' ? 'from-rose-400/80 to-transparent' : 'from-emerald-400/80 to-transparent'}`}></div>
                         
                         <div className="flex justify-between items-center">
                           <div className={`text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1.5 ${l.side === 'LONG' ? 'text-rose-500' : 'text-emerald-500'}`}>
                             {l.symbol} {l.side === 'LONG' ? '📉 LONG PATLAMASI' : '🚀 SHORT'}
                           </div>
                           
                           {l.sizeClass === 'whale' && <span className="bg-pink-50 border border-pink-200 text-pink-600 text-[9px] font-extrabold px-2 py-0.5 rounded-full font-mono shadow-sm">🐳 WHALE</span>}
                           {l.sizeClass === 'mid' && <span className="bg-indigo-50 border border-indigo-100 text-indigo-500 text-[9px] font-extrabold px-2 py-0.5 rounded-full font-mono">🌊 MID</span>}
                           {l.sizeClass === 'small' && <span className="bg-slate-50 border border-slate-200 text-slate-400 text-[9px] font-extrabold px-2 py-0.5 rounded-full font-mono">💧 SMALL</span>}
                         </div>

                         <div className="flex justify-between items-end mt-1">
                           <div className="flex gap-4">
                             <div>
                               <div className="text-[8px] text-slate-400 uppercase font-bold mb-0.5">Fiyat</div>
                               <div className="text-[11px] font-bold font-mono text-slate-600">${Utils.formatPrice(l.price)}</div>
                             </div>
                             <div>
                               <div className="text-[8px] text-slate-400 uppercase font-bold mb-0.5">Toplam Zarar</div>
                               <div className={`text-[11px] font-bold font-mono ${l.sizeClass === 'whale' ? 'text-pink-500' : 'text-slate-600'}`}>${Utils.formatMoney(l.amount)}</div>
                             </div>
                           </div>
                           <div className="text-[9px] text-slate-400 font-mono">{Utils.formatTime(l.ts)}</div>
                         </div>

                         <div className="mt-1">
                           <div className="h-1.5 bg-slate-50 rounded-full overflow-hidden">
                             <div className={`h-full rounded-full transition-all duration-500 ${l.side === 'LONG' ? 'bg-gradient-to-r from-rose-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-teal-500'}`} style={{ width: `${Math.min(100, (l.amount / 500000) * 100)}%` }}></div>
                           </div>
                           <div className="text-[8px] text-right text-slate-400 font-mono mt-0.5">${Utils.formatVol(l.amount)} / $500K</div>
                         </div>
                       </div>
                     ))
                   )}
                 </div>
               </div>
             </div>
          )}

          {/* PERFORMANCE TAB */}
          {activeTab === 'performance' && (
            <div className="space-y-4">
              <div className="bg-white border text-center border-emerald-100 p-6 rounded-2xl shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400"></div>
                
                <h3 className="text-[10px] uppercase font-extrabold text-slate-400 mb-4 tracking-widest">{settings.profile} Profili Başarı Oranı</h3>
                
                {history.length === 0 ? (
                  <div className="py-8 text-slate-400 text-xs font-bold">
                    Henüz analiz edilecek sinyal geçmişi yok.
                  </div>
                ) : (() => {
                  const resolved = history.filter(h => h.result);
                  const total = resolved.length;
                  const won = resolved.filter(h => h.result === 'WIN').length;
                  const winRate = total > 0 ? (won / total) * 100 : 0;
                  const displayRate = winRate.toFixed(0);
                  const dashOffset = 251 - (251 * (winRate / 100));

                  return (
                    <>
                      <div className="relative w-24 h-24 mx-auto mb-5">
                        <svg className="w-full h-full transform -rotate-90 drop-shadow-sm" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                          <circle cx="50" cy="50" r="40" fill="none" stroke="url(#pastelGrad)" strokeWidth="8" strokeDasharray="251" strokeDashoffset={dashOffset} strokeLinecap="round" className="transition-all duration-1000" />
                          <defs>
                            <linearGradient id="pastelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor={winRate >= 50 ? "#34d399" : "#fbbf24"} />
                              <stop offset="100%" stopColor={winRate >= 50 ? "#2dd4bf" : "#f59e0b"} />
                            </linearGradient>
                          </defs>
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className={`text-2xl font-extrabold font-mono tracking-tighter ${total > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {total > 0 ? `${displayRate}%` : '--'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-slate-50/50 rounded-xl p-2">
                          <div className="text-[9px] text-slate-400 uppercase font-extrabold">Kapanan</div>
                          <div className="text-sm font-bold text-indigo-500 font-mono mt-0.5">{total}</div>
                        </div>
                        <div className="bg-emerald-50/50 rounded-xl p-2">
                          <div className="text-[9px] text-emerald-400 uppercase font-extrabold">Başarılı</div>
                          <div className="text-sm font-bold text-emerald-600 font-mono mt-0.5">{won}</div>
                        </div>
                        <div className="bg-rose-50/50 rounded-xl p-2">
                          <div className="text-[9px] text-rose-400 uppercase font-extrabold">Stop/Zarar</div>
                          <div className="text-sm font-bold text-rose-600 font-mono mt-0.5">{total - won}</div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="bg-white border text-center border-emerald-100 p-4 rounded-2xl shadow-sm text-center mt-3">
                <CheckCircle className="mx-auto text-emerald-400 mb-2" size={24} />
                <p className="text-xs font-bold text-slate-600">Simülasyon Modu Aktif</p>
                <p className="text-[10px] text-slate-400 mt-1">Sinyaller otomatik değerlendirilip istatistiğe dahil ediliyor.</p>
              </div>
            </div>
          )}

          {/* SETTINGS / FILTERS TAB */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              
              <div className="bg-white border border-emerald-100 p-4 rounded-2xl shadow-sm">
                <h2 className="text-[10px] font-extrabold text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Target size={14}/> Sinyal Motoru</h2>
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold block mb-1.5">Sembol</span>
                    <div className="flex gap-2">
                      {['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map(sym => (
                        <button key={sym} onClick={() => setSettings(s => ({...s, symbol: sym}))} 
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                            settings.symbol === sym ? 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm' : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                          {sym.replace('USDT', '')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1.5">
                       <span className="text-[10px] text-slate-500 font-bold">Güven Eşiği (Min: %{settings.minConf})</span>
                    </div>
                    <input type="range" min="40" max="95" step="5" value={settings.minConf} 
                      onChange={(e) => setSettings(s => ({...s, minConf: parseInt(e.target.value)}))}
                      className="w-full h-1.5 bg-emerald-100 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-emerald-100 p-4 rounded-2xl shadow-sm">
                <h2 className="text-[10px] font-extrabold text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><ListFilter size={14}/> Akış Filtreleri (Market)</h2>
                
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                       <span className="text-slate-500">Min. İşlem Gösterimi</span>
                       <span className="font-mono text-indigo-500">${Utils.formatVol(settings.minTradeUsd)}</span>
                    </div>
                    <input type="range" min="1000" max="100000" step="1000" value={settings.minTradeUsd} 
                      onChange={(e) => setSettings(s => ({...s, minTradeUsd: parseInt(e.target.value)}))}
                      className="w-full h-1.5 bg-indigo-50 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                       <span className="text-slate-500">Balina (Whale) Eşiği</span>
                       <span className="font-mono text-fuchsia-500">${Utils.formatVol(settings.whaleThresh)}</span>
                    </div>
                    <input type="range" min="10000" max="500000" step="10000" value={settings.whaleThresh} 
                      onChange={(e) => setSettings(s => ({...s, whaleThresh: parseInt(e.target.value)}))}
                      className="w-full h-1.5 bg-fuchsia-50 rounded-lg appearance-none cursor-pointer accent-fuchsia-500" />
                  </div>

                  <div className="flex justify-between items-center bg-slate-50 p-2 rounded-xl border border-slate-100 mt-2">
                     <div>
                       <div className="text-[11px] font-bold text-slate-600">Liste Kapasitesi</div>
                       <div className="text-[9px] text-slate-400">Performans için ({settings.maxListItems} limit)</div>
                     </div>
                     <select 
                       value={settings.maxListItems} 
                       onChange={(e) => setSettings(s => ({...s, maxListItems: parseInt(e.target.value)}))}
                       className="bg-white border border-slate-200 text-slate-600 text-[10px] font-bold rounded-lg px-2 py-1 outline-none"
                     >
                       <option value={30}>30 Öğe</option>
                       <option value={50}>50 Öğe</option>
                       <option value={100}>100 Öğe</option>
                     </select>
                  </div>

                  <div className="flex justify-between items-center bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-100 mt-2">
                     <div>
                       <div className="text-[11px] font-bold text-emerald-700">Alışları Göster</div>
                       <div className="text-[9px] text-emerald-600/70">Yeşil mum akışlarını listeler</div>
                     </div>
                     <button 
                       onClick={() => setSettings(s => ({...s, showBuys: !s.showBuys}))}
                       className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${settings.showBuys ? 'bg-emerald-500' : 'bg-slate-300'}`}
                     >
                       <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${settings.showBuys ? 'translate-x-4' : 'translate-x-0'}`}></div>
                     </button>
                  </div>

                  <div className="flex justify-between items-center bg-rose-50/50 p-2.5 rounded-xl border border-rose-100 mt-2">
                     <div>
                       <div className="text-[11px] font-bold text-rose-700">Satışları Göster</div>
                       <div className="text-[9px] text-rose-600/70">Kırmızı mum akışlarını listeler</div>
                     </div>
                     <button 
                       onClick={() => setSettings(s => ({...s, showSells: !s.showSells}))}
                       className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${settings.showSells ? 'bg-rose-500' : 'bg-slate-300'}`}
                     >
                       <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${settings.showSells ? 'translate-x-4' : 'translate-x-0'}`}></div>
                     </button>
                  </div>

                </div>
              </div>

              <div className="bg-white border text-center border-emerald-100 p-4 rounded-2xl shadow-sm text-center">
                 <h2 className="text-[10px] font-extrabold text-rose-500 uppercase tracking-widest mb-3 flex items-center justify-center gap-1.5"><Bell size={14}/> Bildirimler</h2>
                 <div className="flex items-center justify-between text-left bg-slate-50 p-2.5 rounded-xl border border-slate-100 mb-3">
                    <div>
                      <div className="text-[11px] font-bold text-slate-600">Sesli Uyarı (Alarms)</div>
                      <div className="text-[9px] text-slate-400">Sinyal & Balina işleminde öter</div>
                    </div>
                    <button 
                      onClick={() => setSettings(s => ({...s, sound: !s.sound}))}
                      className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${settings.sound ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    >
                      <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${settings.sound ? 'translate-x-4' : 'translate-x-0'}`}></div>
                    </button>
                 </div>

                 <div className="flex items-center justify-between text-left bg-slate-50 p-2.5 rounded-xl border border-slate-100 mb-3">
                    <div>
                      <div className="text-[11px] font-bold text-slate-600">Sarsıntı Efekti (Ekran)</div>
                      <div className="text-[9px] text-slate-400">Balina & Likidasyonda titrer</div>
                    </div>
                    <button 
                      onClick={() => setSettings(s => ({...s, shakeEnabled: !s.shakeEnabled}))}
                      className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${settings.shakeEnabled ? 'bg-indigo-500' : 'bg-slate-300'}`}
                    >
                      <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${settings.shakeEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                    </button>
                 </div>
                 
                 <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-2 border border-emerald-100">
                    <CheckCircle size={20} />
                 </div>
                 <h3 className="text-xs font-bold text-slate-600 mb-1">Motor Aktif</h3>
                 <p className="text-[10px] text-slate-400">Ayarlar saniyesinde uygulanır.</p>
              </div>

            </div>
          )}
          
        </div>

        {/* Bottom Navigation */}
        <nav className="bg-white/95 backdrop-blur-xl border-t border-emerald-100 flex justify-between px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-50">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-2 rounded-xl flex-1 transition-all relative ${
                activeTab === tab.id 
                  ? 'text-emerald-600' 
                  : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50/50'
              }`}>
              <div className="relative">
                {tab.icon}
                {tab.id === 'signals' && signals.length > 0 && <span className="absolute -top-1 -right-2 w-3.5 h-3.5 bg-pink-500 text-white rounded-full flex items-center justify-center text-[8px] border-2 border-white font-bold">{signals.length}</span>}
                {tab.id === 'market' && activeTab !== 'market' && trades.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 border-2 border-white rounded-full"></span>}
              </div>
              <span className={`text-[9px] font-bold tracking-wide ${activeTab === tab.id ? 'opacity-100' : 'opacity-70'}`}>{tab.label}</span>
              {activeTab === tab.id && <div className="absolute -bottom-[6px] w-[20px] h-[3px] rounded-full bg-emerald-500"></div>}
            </button>
          ))}
        </nav>

      </div>
    </div>
  );
}

