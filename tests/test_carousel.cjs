/* Test carousel behavior against the actual browser-side custom element without third-party dependencies. */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const classes = new Map();
let time = 0, nextId = 0;
const timers = new Map();
const artworkTimers = new Map();
const frames = new Map();
class MockHTMLElement {
  attachShadow() {
    this.shadowRoot = {
      content: '', renders: 0,
      get innerHTML() { return this.content; },
      set innerHTML(value) { this.content = value; this.renders += 1; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    this.style = {};
    return this.shadowRoot;
  }
  matches() { return false; }
}
const env = {
  HTMLElement: MockHTMLElement,
  customElements: {define(name, cls) { classes.set(name, cls); }, get(name) { return classes.get(name); }},
  window: {customCards: [], matchMedia() { return {matches: false}; }},
  document: {hidden: false, createElement() { return {}; }},
  setInterval(fn, duration) { const id = ++nextId; timers.set(id, {fn, duration}); return id; },
  clearInterval(id) { timers.delete(id); },
  setTimeout(fn, delay) { const id = ++nextId; artworkTimers.set(id, {fn, delay}); return id; },
  clearTimeout(id) { artworkTimers.delete(id); },
  requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
  cancelAnimationFrame(id) { frames.delete(id); },
  performance: {now: () => time},
  Date, URL, CSS: {escape: text => text}, console,
};
const source = readFileSync(join(__dirname, '..', 'custom_components', 'tracearr_ha', 'frontend', 'tracearr-card.js'), 'utf8');
vm.runInNewContext(source, env);
const Card = classes.get('tracearr-streams-card');
assert.ok(Card, 'Lovelace custom element registered');

function setup({count=3, visible=1, effect='none', duration=600}={}) {
  const card = new Card();
  const animations = [];
  const cards = Array.from({length:count}, (_,i) => ({
    offsetLeft: i * 110, dataset:{session:`s${i+1}`},
    getBoundingClientRect() { return {width:100}; },
    animate(keyframes, opts) { animations.push({card:i, keyframes, opts}); },
  }));
  const listeners = [];
  const carousel = {
    cards, style: {}, scrollLeft: 0, clientWidth: visible*110-10,
    querySelectorAll(selector) { return selector === '.stream' ? cards : []; },
    addEventListener(event, fn) { listeners.push({event, fn}); },
  };
  card.isConnected = true;
  card._config = {...card._config, mode:'carousel', carousel_visible:visible,
    carousel_transition:effect, carousel_transition_speed:duration, carousel_autoplay:true};
  card.shadowRoot.querySelector = selector => {
    if (selector === '.streams.carousel') return carousel;
    if (selector === 'ha-card') return card.shadowRoot.renders ? {} : null;
    return null;
  };
  return {card,carousel,cards,animations,listeners};
}
function flushFrame(at) {
  time = at;
  const jobs = [...frames.values()];
  frames.clear();
  for (const job of jobs) job(time);
}

test('autoplay advances through all items and wraps to first (instead of jumping back)', () => {
  const {card, carousel} = setup({count:3});
  card._setTimers();
  const timer = [...timers.values()].filter(t => t.duration === 7000).at(-1);
  assert.ok(timer, 'autoplay timer configured');
  for (const [index, left] of [[1,110],[2,220],[0,0],[1,110]]) {
    timer.fn();
    assert.equal(card._carouselIndex, index);
    assert.equal(carousel.scrollLeft, left);
  }
  card.disconnectedCallback();
});

test('carousel honors multiple visible slides and wraps only after last complete view', () => {
  const {card,carousel} = setup({count:4, visible:2});
  for (const index of [1,2,0]) {
    card._scroll(1);
    assert.equal(card._carouselIndex, index);
    assert.equal(carousel.scrollLeft, index*110);
  }
  card._scroll(-1);
  assert.equal(card._carouselIndex, 2);
});

test('transition effects fade, zoom and 3D flip use configured duration', () => {
  for (const effect of ['fade','zoom','flip']) {
    const {card,animations} = setup({count:3, visible:2, effect, duration:1250});
    card._scroll(1);
    assert.equal(card._carouselIndex, 1);
    assert.equal(animations.length,2);
    assert.equal(animations[0].opts.duration,1250);
    assert.ok(animations[0].keyframes[0].opacity < 1);
  }
});

test('slide transition animates scroll at chosen speed', () => {
  time = 0;
  const {card,carousel} = setup({count:3, effect:'slide',duration:600});
  card._scroll(1);
  assert.equal(card._carouselAnimating,true);
  flushFrame(300);
  assert.ok(carousel.scrollLeft > 0 && carousel.scrollLeft < 110);
  flushFrame(600);
  assert.equal(carousel.scrollLeft,110);
  assert.equal(card._carouselAnimating,false);
  assert.equal(carousel.style.scrollSnapType,'');
});

test('progress-only SSE updates preserve carousel DOM, index and scroll position', () => {
  time = 0;
  const {card,carousel} = setup({count:2});
  const stream = {id:'s1', username:'Alice',server_id:'x',server_name:'Plex',server_type:'plex',media_type:'movie',
    media_title:'Test',state:'playing',started_at:'2026-11-03T10:00:00Z',progress_ms:1000,duration_ms:100000};
  const entry = {id:'tracearr',connected:true,streams:[stream],stats:{total:1},servers:[]};
  card._payload = {entries:[entry]};
  card._config = {...card._config, mode:'carousel',carousel_visible:1,show_poster:false,show_avatar:false};
  card.render();
  const before = card.shadowRoot.renders;
  card._carouselIndex = 1;
  carousel.scrollLeft = 110;
  time = 2000;
  stream.progress_ms = 2800; // slightly stale compared to 3000ms local clock
  card.render();
  assert.equal(card.shadowRoot.renders,before);
  assert.equal(card._carouselIndex,1);
  assert.equal(carousel.scrollLeft,110);
  assert.ok(card._positions.get('s1').progress >= 2950, 'SSE does not reset playback to stale position');
});

test('stream left-edge colors match Plex, Jellyfin and Emby brand themes', () => {
  const {card} = setup();
  card._config = {...card._config,show_poster:false,show_avatar:false};
  for (const [server,color] of [['plex','#E5A00D'],['jellyfin','#AA5CC3'],['emby','#52B54B']]) {
    const html = card._streamCard(null,{id:'1', username:'x', server_type:server,
      media_title:'Movie', media_type:'movie',state:'playing',progress_ms:0,duration_ms:10000});
    assert.ok(html.includes(`--stream-accent:${color}`), `${server} has its own accent`);
  }
});

test('carousel never renders a native scroll bar, even with an old saved false value', () => {
  const {card} = setup();
  card._config = {...card._config, mode:'carousel',carousel_hide_scrollbar:false,show_poster:false,show_avatar:false};
  card.render();
  assert.match(card.shadowRoot.innerHTML, /streams carousel/);
  assert.match(card.shadowRoot.innerHTML, /\.streams\.carousel::\-webkit-scrollbar \{ display:none/);
  assert.match(card.shadowRoot.innerHTML, /scrollbar-width:none/);
});


test('responsive carousel advances even when CSS displays one item on narrow cards', () => {
  const {card,carousel} = setup({count:3, visible:2});
  carousel.clientWidth = 100; // container query collapses to a single visible card
  card._scroll(1);
  card._scroll(1);
  assert.equal(card._carouselIndex,2);
  assert.equal(carousel.scrollLeft,220);
  card._scroll(1);
  assert.equal(card._carouselIndex,0);
});

test('autoplay remains active while hovering unless pause on hover is opted in', () => {
  const {card} = setup({count:3});
  card.matches = () => true;
  card._setTimers();
  const timer = [...timers.values()].filter(t => t.duration === 7000).at(-1);
  timer.fn();
  assert.equal(card._carouselIndex, 1);
  card._config.carousel_pause_on_hover = true;
  timer.fn();
  assert.equal(card._carouselIndex, 1);
  card.disconnectedCallback();
});


test('video and audio icons indicate independent direct, transcode or unknown states', () => {
  const {card} = setup();
  card._config = {...card._config,show_poster:false,show_avatar:false};
  const base = {id:'abc', username:'x', server_type:'plex',media_title:'Film',media_type:'movie',state:'playing',progress_ms:0,duration_ms:10000};
  let html=card._streamCard(null,{...base,video_decision:'directplay',audio_decision:'transcode',is_transcode:true});
  assert.match(html, /stream-indicator direct.*Video: Direct play/s);
  assert.match(html, /stream-indicator transcode.*Audio: Transcode/s);
  assert.doesNotMatch(html, /chip.*Video transcode/);
  html=card._streamCard(null,{...base,video_decision:null,audio_decision:'copy'});
  assert.match(html, /stream-indicator unknown.*Video: Unknown/s);
  assert.match(html, /stream-indicator direct.*Audio: Direct play/s);
  card._config.show_transcode_icons=false;
  html=card._streamCard(null,{...base,video_decision:'transcode',audio_decision:'transcode'});
  assert.doesNotMatch(html,/media-flags/);
});

test('paused stream overlays poster and replaces remaining time with orange Paused', () => {
  const {card} = setup();
  card._config = {...card._config,show_poster:true,show_avatar:false,show_progress:true,show_remaining:true};
  // Set up fake image proxy avoiding external calls.
  card._image = (_,__,kind)=>kind==='poster'?'https://example.com/affiche.png':'';
  const base = {id:'abc', username:'x', server_type:'plex',media_title:'Film',media_type:'movie',state:'paused',progress_ms:20000,duration_ms:100000};
  let html=card._streamCard(null,base);
  assert.match(html, /poster-paused/);
  assert.match(html, /pause-symbol/);
  assert.match(html, /class="time-paused">Paused/);
  assert.doesNotMatch(html,/class="time-remaining"/);
  assert.doesNotMatch(html,/class="stream paused"/);
  card._config.show_remaining=false;
  html=card._streamCard(null,base);
  assert.match(html,/class="time-paused">Paused/);
  card._config.show_remaining=true;
  html=card._streamCard(null,{...base,state:'playing'});
  assert.doesNotMatch(html,/poster-paused/);
  assert.match(html,/class="time-remaining"/);
});

test('global palette styles progress and quality badges using theme, server or custom color', () => {
  const {card} = setup();
  card._config = {...card._config,show_poster:false,show_avatar:false,show_quality:true,show_bitrate:true};
  const s={id:'x', username:'x', server_type:'jellyfin',resolution:'4K',bitrate:12000,
    media_title:'Film',media_type:'movie',state:'playing',progress_ms:0,duration_ms:10000};
  let html=card._streamCard(null,s);
  assert.match(html, /--shared-accent:var\(--accent-color,#00BCD4\)/);
  assert.match(html, /--pill-bg:var\(--accent-color,#00BCD4\)/);
  assert.match(html, /--pill-text:#000000/);
  assert.match(html, /class="chip">4K/);
  assert.match(html, /class="chip">12\.0 Mb\/s/);
  card._config.accent_color_mode='server';
  html=card._streamCard(null,s);
  assert.match(html, /--shared-accent:#AA5CC3/);
  assert.match(html, /--pill-text:#000000/); // contrast on Jellyfin violet is slightly better with black
  html=card._streamCard(null,{...s,server_type:'plex'});
  assert.match(html, /--shared-accent:#E5A00D/);
  assert.match(html, /--pill-text:#000000/);
  card._config.accent_color_mode='custom';
  card._config.accent_custom_color='#101820';
  html=card._streamCard(null,s);
  assert.match(html, /--shared-accent:#101820/);
  assert.match(html, /--pill-text:#FFFFFF/);
  card._config.accent_custom_color='#ffed00';
  html=card._streamCard(null,s);
  assert.match(html, /--pill-text:#000000/);
  card._config.accent_custom_color='red;background:url(https://bad.example)';
  html=card._streamCard(null,s);
  assert.match(html, /--shared-accent:#00BCD4/);
  assert.doesNotMatch(html,/bad\.example/);
});

test('header metrics are configurable independently and count only visible sessions', () => {
  const {card}=setup();
  const streams=[
    {id:'1',server_id:'p',server_name:'Plex',server_type:'plex',is_transcode:true,video_decision:'transcode',audio_decision:'copy',bitrate:5000,state:'playing'},
    {id:'2',server_id:'p',server_name:'Plex',server_type:'plex',video_decision:'directplay',audio_decision:'directplay',bitrate:3000,state:'paused'},
    {id:'3',server_id:'j',server_name:'Jellyfin',server_type:'jellyfin',is_transcode:true,video_decision:'transcode',audio_decision:'transcode',bitrate:4000,state:'playing'},
  ];
  card._config={...card._config,title:'Activité multimédia',
    show_header:true, header_show_streams:true,header_show_bandwidth:true,header_show_server_counts:true,
    header_show_video:true,header_show_both:true,header_show_audio:false,header_show_paused:false};
  const html=card._header(streams);
  for(const fragment of ['Activité multimédia','3 streams','Bitrate : 12.0 Mb/s','Video : 1','Video + audio : 1','Plex : 2','Jellyfin : 1']) {
    assert.ok(html.includes(fragment),fragment);
  }
  assert.doesNotMatch(html, /Audio : 0|Paused : 1/);
  card._config.show_header=false;
  assert.equal(card._header(streams),'');
  card._config.show_header=true;card._config.show_title=false;
  assert.doesNotMatch(card._header(streams),/Activité multimédia/);
});

test('server metrics use server-specific color and custom header colors apply globally', () => {
  const {card}=setup();
  const streams=[{server_id:'p',server_type:'plex',server_name:'Plex',video_decision:'directplay',audio_decision:'directplay'}];
  card._config={...card._config,accent_color_mode:'server',header_show_server_counts:true};
  assert.match(card._header(streams),/Plex : 1/);
  assert.match(card._header(streams),/--pill-bg:#E5A00D;--pill-text:#000000/);
  card._config.accent_color_mode='custom';card._config.accent_custom_color='#001122';
  assert.match(card._header(streams),/--pill-bg:#001122;--pill-text:#FFFFFF/);
});

test('legacy color and summary settings are migrated, and new options win', () => {
  const {card}=setup();
  card.setConfig({show_counter:false,show_transcodes:true,progress_color_mode:'server'});
  assert.equal(card._config.header_show_streams,false);
  assert.equal(card._config.header_show_video,true);
  assert.equal(card._config.header_show_transcodes_total,true);
  assert.equal(card._config.accent_color_mode,'server');
  card.setConfig({accent_color_mode:'custom',accent_custom_color:'#121212',
    progress_color_mode:'server',header_show_video:false,show_transcodes:true});
  assert.equal(card._config.accent_color_mode,'custom');
  assert.equal(card._config.header_show_video,false);
});

test('native ha-card surface, nested stream panel and centered poster survive wrapped footer', () => {
  const {card}=setup();
  card._config={...card._config,show_poster:false,show_avatar:false};
  card.render();
  const html=card.shadowRoot.innerHTML;
  assert.match(html,/ha-card \{ border-radius:var\(--ha-card-border-radius/);
  assert.doesNotMatch(html,/background:transparent!important/);
  assert.match(html,/\.stream \{ position:relative; isolation:isolate; overflow:hidden;[\s\S]*?display:flex; align-items:center/);
  assert.match(html,/\.poster-wrap \{[^}]*align-self:center/s);
  assert.match(html,/\.meta \{[^}]*flex-wrap:wrap/s);
  card._config.stream_surface='transparent';card._renderFingerprint=null;card.render();
  assert.match(card.shadowRoot.innerHTML,/flat-streams/);
});

test('editor keeps layout in general display and renders header counters as simple checkboxes', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card'});
  const html=editor.shadowRoot.innerHTML;
  for (const title of ['General display','Playback and filters','Carousel navigation','Header and badges','Titles, seasons, and years',
    'Stream details','Local / remote bitrate','Per-card settings'])
    assert.ok(html.includes(title),title);
  assert.doesNotMatch(html,/data-section="layout"/);
  assert.match(html,/data-subdetail="metric-streams"/);
  assert.match(html,/data-section="global"[\s\S]*data-field="mode"[\s\S]*data-section="source"/);
  assert.match(html,/Adaptive grid[\s\S]*data-field="columns"/);
  for (const field of ['streams','bandwidth','direct','paused','video','audio','both','transcodes_total','server_counts']) {
    assert.match(html,new RegExp(`<input type="checkbox" data-field="header_show_${field}"`));
  }
  assert.match(html,/data-subdetail="metrics"/);
  assert.match(html,/data-subdetail="shared-badges"/);
  assert.match(html,/data-field="header_show_server_counts"/);
  assert.match(html,/data-field="accent_color_mode"/);
  assert.match(html,/data-field="show_quality"/);
  for (const obsolete of ['Sections width','Initial Sections height','CSS height outside Sections'])
    assert.ok(!html.includes(obsolete),obsolete);
});

test('native Sections layout owns size and the adaptive grid keeps its column count', () => {
  const {card}=setup();
  const opts=card.getGridOptions();
  assert.equal(opts.rows,4);
  assert.equal(opts.min_rows,2);
  assert.equal(opts.max_rows,30);
  card.setConfig({mode:'grid',columns:'2',height:330,grid_rows:7,grid_columns:6,font_size:18});
  assert.equal(card._config.mode,'grid');
  assert.equal(card._config.columns,'2');
  for(const removed of ['height','grid_rows','grid_columns'])
    assert.ok(!(removed in card._config),removed);
  card.render();
  const html=card.shadowRoot.innerHTML;
  assert.doesNotMatch(html,/height:330px/);
  assert.match(html,/--tr-font-size:18px/);
  assert.match(html,/class="streams grid"/);
  assert.match(html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html,/--min-column:290px/);
  card.setConfig({mode:'grid',columns:'auto',compact:true});
  card.render();
  const auto=card.shadowRoot.innerHTML;
  assert.match(auto,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,var\(--min-column,290px\)\),1fr\)\)/);
  assert.match(auto,/--min-column:210px/);
  assert.match(auto,/@container \(max-width:520px\)[\s\S]*\.streams\.grid \{ grid-template-columns:1fr!important;/);
  card.setConfig({mode:'list'});
  assert.equal(card._config.mode,'list');
  card.render();
  assert.match(card.shadowRoot.innerHTML,/class="streams list"/);
  assert.equal(card.getGridOptions().rows,4);
});

test('arrows can be hidden but carousel keyboard controls and dragging remain supported', () => {
  const {card,carousel,cards,listeners}=setup({count:3,visible:1,effect:'none'});
  card._config.carousel_show_arrows=false;
  card._config.carousel_mouse_drag=true;
  const classes=new Set();
  carousel.classList={add:c=>classes.add(c),remove:c=>classes.delete(c)};
  carousel.setPointerCapture=()=>{};
  carousel.hasPointerCapture=()=>false;
  card._enableMouseDrag(carousel,cards);
  const get = name => listeners.find(l=>l.event===name).fn;
  get('pointerdown')({pointerType:'mouse',button:0,clientX:220,pointerId:1});
  assert.ok(classes.has('is-dragging'));
  get('pointermove')({clientX:100,preventDefault:()=>{}});
  assert.equal(carousel.scrollLeft,120);
  get('pointerup')({pointerId:1});
  assert.equal(card._carouselIndex,1);
  assert.equal(carousel.scrollLeft,110);
  assert.ok(!classes.has('is-dragging'));
  get('keydown')({key:'ArrowRight',preventDefault:()=>{}});
  assert.equal(card._carouselIndex,2);
  card._payload={entries:[{id:'a',connected:true,streams:cards.map((c,i)=>({id:String(i),username:'x',server_type:'plex',media_title:'Film',media_type:'movie',state:'playing',started_at:String(i),progress_ms:0,duration_ms:10000}))}]};
  card._renderFingerprint=null;
  card.render();
  assert.doesNotMatch(card.shadowRoot.innerHTML,/data-step="-1"/);
});


test('irregular SSE samples keep elapsed and remaining times monotonic and nearly one second per second', () => {
  time = 0;
  const {card} = setup();
  const stream = {id:'video', started_at:'2026-11-03T17:30:00Z', media_title:'Film',
    state:'playing', progress_ms:2_928_000, duration_ms:6_880_000};
  card._syncPosition(stream);
  let last = 2_928_000;
  // Reproduces samples arriving every 2s with irregular, sometimes stale source positions.
  const jitter = [0,-800,600,-1700,900,-1100,1400,-650,800,-1900,1000];
  for (let sec=1; sec<=20; sec++) {
    time = sec*1000;
    if (sec % 2 === 0) {
      stream.progress_ms = 2_928_000 + sec*1000 + jitter[sec/2];
      card._syncPosition(stream);
    }
    const clock = card._positions.get('video');
    const shown = card._positionAt(clock);
    const change = shown-last;
    assert.ok(change >= 0, `not moving backwards at ${sec}s: ${change}`);
    assert.ok(change > 700 && change < 1300, `steady seconds at ${sec}s: ${change}`);
    assert.ok(6_880_000-shown <= 6_880_000-last, `remaining time does not increase at ${sec}s`);
    clock.lastRendered = shown;
    last = shown;
  }
});

test('pause freezes countdown, resume continues smoothly, and a new session resets the clock', () => {
  time = 0;
  const {card} = setup();
  const s = {id:'p', started_at:'start1', media_title:'A', state:'playing', progress_ms:60000,duration_ms:120000};
  card._syncPosition(s);
  time = 3000;
  s.state = 'paused'; s.progress_ms=62100;
  card._syncPosition(s);
  const frozen=card._positionAt(card._positions.get('p'));
  time=9000;
  s.progress_ms=62500;
  card._syncPosition(s);
  assert.equal(card._positionAt(card._positions.get('p')),frozen);
  s.state='playing';s.progress_ms=63100;
  card._syncPosition(s);
  time=10000;
  assert.ok(card._positionAt(card._positions.get('p')) > frozen + 700);
  s.started_at='start2';s.media_title='B';s.progress_ms=1500;
  card._syncPosition(s);
  assert.equal(card._positionAt(card._positions.get('p')),1500);
});

test('actual seek forward or backward causes intentional jumps, unlike jitter', () => {
  time = 0;
  const {card} = setup();
  const stream={id:'s',started_at:'A',media_title:'Test',state:'playing',progress_ms:50000,duration_ms:240000};
  card._syncPosition(stream);
  time=2000;stream.progress_ms=51700;card._syncPosition(stream);
  card._positions.get('s').lastRendered = card._positionAt(card._positions.get('s'));
  time=4000;stream.progress_ms=20000;
  card._syncPosition(stream);
  assert.equal(card._positionAt(card._positions.get('s')),20000);
  assert.equal(card._positions.get('s').lastRendered,20000);
  time=5000;stream.progress_ms=90000;
  card._syncPosition(stream);
  assert.equal(card._positionAt(card._positions.get('s')),90000);
});

test('progress clock uses monotonic time and a 250ms UI tick', () => {
  const {card} = setup();
  card._setTimers();
  assert.ok([...timers.values()].some(t => t.duration === 250));
  card.disconnectedCallback();
});


test('movie title and year are independent of TV year and may be reordered', () => {
  const {card}=setup();
  const movie={id:'film',media_type:'movie',media_title:'Le Voyage',year:2026};
  const episode={id:'tv',media_type:'episode',show_title:'Ma série',media_title:'Pilote',
    season_number:2,episode_number:4,year:2024};
  assert.deepEqual(Array.from(card._mediaFields(movie), x=>x.text), ['Le Voyage','2026']);
  assert.deepEqual(Array.from(card._mediaFields(episode), x=>x.text), ['Ma série','S02','E04','Pilote','2024']);
  card._config.movie_show_year=false;
  card._config.series_show_year=true;
  assert.ok(!card._mediaMarkup(movie).includes('2026'));
  assert.match(card._mediaMarkup(episode),/2024/);
  card._config.series_show_episode_title=false;
  assert.ok(!card._mediaMarkup(episode).includes('Pilote'));
  card._config.series_show_title=false;
  assert.ok(!card._mediaMarkup(episode).includes('Ma série'));
  card._config.series_show_season=false;
  card._config.series_show_episode_number=false;
  assert.ok(!card._mediaMarkup(episode).includes('S02E04'));
  assert.match(card._mediaMarkup(episode),/class="title" title="2024"/);
  card._config.movie_show_title=false;
  assert.equal(card._mediaMarkup(movie),'');
});

test('custom title, episode and year order works with short and long season formats', () => {
  const {card}=setup();
  const s={id:'tv',media_type:'episode',show_title:'Les Lacs',media_title:'Rencontre',year:2022,
    season_number:1,episode_number:7};
  card._config.series_episode_style='long';
  card._config.series_field_order='year,episode,series,season';
  assert.deepEqual(Array.from(card._mediaFields(s), x=>x.text),
    ['2022','Rencontre','Les Lacs','Season 1','Episode 7']);
  let html=card._mediaMarkup(s);
  assert.match(html,/class="title" title="2022"/);
  assert.match(html,/Rencontre · Les Lacs · Season 1 · Episode 7/);
  card._config.series_field_order='season,year,season,invalid,episode,series';
  assert.deepEqual(Array.from(card._mediaFields(s), x=>x.text),
    ['Season 1','2022','Rencontre','Les Lacs','Episode 7']);
  card._config.series_episode_style='short';
  card._config.series_field_order='season,episode_number,year,episode,series';
  assert.match(card._mediaMarkup(s),/S01E07/);
  card._config.movie_field_order='year,title';
  assert.deepEqual(Array.from(card._mediaFields({media_type:'movie',media_title:'Dune',year:2021}), x=>x.text),
    ['2021','Dune']);
});

test('header metric badge color can differ from global palette with accessible contrast', () => {
  const {card}=setup();
  const entries=[{server_id:'p',server_name:'Plex',server_type:'plex',media_type:'movie'}];
  card._config={...card._config, header_show_server_counts:true,
    accent_color_mode:'server', header_badge_color_mode:'custom',header_badge_custom_color:'#202020'};
  let html=card._header(entries);
  assert.match(html,/--pill-bg:#202020;--pill-text:#FFFFFF/g);
  card._config.header_badge_color_mode='server';
  html=card._header(entries);
  assert.match(html,/Plex : 1/);
  assert.match(html,/--pill-bg:#E5A00D;--pill-text:#000000/);
  card._config.header_badge_color_mode='theme';
  html=card._header(entries);
  assert.doesNotMatch(html,/--pill-bg:#E5A00D/);
});

test('legacy show_year migrates to independent movie and series year settings', () => {
  const {card}=setup();
  card.setConfig({show_year:false});
  assert.equal(card._config.movie_show_year,false);
  assert.equal(card._config.series_show_year,false);
  card.setConfig({show_year:false,movie_show_year:true});
  assert.equal(card._config.movie_show_year,true);
  assert.equal(card._config.series_show_year,false);
});

test('media editor exposes individual toggles and reorder buttons', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card'});
  const html=editor.shadowRoot.innerHTML;
  assert.match(html,/Titles, seasons, and years/);
  for(const field of ['movie_show_title','movie_show_year','series_show_title',
    'series_show_episode_title','series_show_season','series_show_episode_number','series_show_year',
    'series_episode_style','header_badge_color_mode','header_badge_custom_color']) {
    assert.match(html,new RegExp('data-field="'+field+'"'));
  }
  assert.match(html,/data-order="series_field_order"/);
  assert.match(html,/data-order="movie_field_order"/);
});

test('changing bitrate/state/health does not rebuild carousel or reset autoplay animation', () => {
  time=0;
  const {card,carousel}=setup({count:2,effect:'slide'});
  const streams=[1,2].map(n=>({id:`s${n}`,username:'Bob',server_id:'p',server_type:'plex',
    server_name:'Plex',media_type:'movie',media_title:`Film ${n}`,state:'playing',
    started_at:`${n}`,bitrate:1000,duration_ms:120000,progress_ms:5000}));
  const entry={id:'e',streams,servers:[{server_id:'p',status:'up'}],connected:true};
  card._payload={entries:[entry]};
  card._config={...card._config,mode:'carousel',carousel_visible:1,
    show_poster:false,show_avatar:false,show_bitrate:true,header_show_bandwidth:true};
  card.render();
  const before=card.shadowRoot.renders;
  card._carouselIndex=1;
  carousel.scrollLeft=110;
  streams[0].bitrate=5000;
  streams[1].state='paused';
  entry.servers[0].status='down';
  card.render();
  assert.equal(card.shadowRoot.renders,before,'stable carousel shell survives SSE changes');
  assert.equal(card._carouselIndex,1);
  assert.equal(carousel.scrollLeft,110);
});

test('manual arrow navigation resets autoplay delay to prevent immediate early jump', () => {
  const {card}=setup({count:3});
  card._setTimers();
  const previous=card._carouselTimer;
  card._scroll(1); // user click
  assert.equal(card._carouselIndex,1);
  assert.notEqual(card._carouselTimer,previous);
  assert.ok(!timers.has(previous));
  assert.ok(timers.has(card._carouselTimer));
  card.disconnectedCallback();
});

// 0.1.7 — individual season/episode, HA entity badges, selective bandwidth and empty state.
test('season and episode number have separate switches, formats and independently ordered fields', () => {
  const {card} = setup();
  const episode = {media_type:'episode', show_title:'Série', media_title:'Fin de partie',
    season_number:3, episode_number:9, year:2026};
  assert.match(card._mediaMarkup(episode), /S03E09/);
  card._config.series_show_season=false;
  assert.doesNotMatch(card._mediaMarkup(episode), /S03/);
  assert.match(card._mediaMarkup(episode), /E09/);
  card._config.series_show_season=true;
  card._config.series_show_episode_number=false;
  assert.match(card._mediaMarkup(episode), /S03/);
  assert.doesNotMatch(card._mediaMarkup(episode), /E09/);
  card._config.series_episode_style='long';
  assert.match(card._mediaMarkup(episode), /Season 3/);
  assert.doesNotMatch(card._mediaMarkup(episode), /Episode 9/);
  card._config.series_show_season=false;
  card._config.series_show_episode_number=true;
  assert.match(card._mediaMarkup(episode), /Episode 9/);
  assert.doesNotMatch(card._mediaMarkup(episode), /Season 3/);
  card._config.series_field_order='episode_number,year,series,episode,season';
  assert.match(card._mediaMarkup(episode), /class="title" title="Episode 9"/);
});

test('legacy season and episode toggle migrates to two independent controls and keeps order', () => {
  const {card}=setup();
  card.setConfig({series_show_season_episode:false,series_field_order:'episode,year,series,season'});
  assert.equal(card._config.series_show_season,false);
  assert.equal(card._config.series_show_episode_number,false);
  assert.deepEqual(card._config.series_field_order.split(','), ['episode','year','series','season','episode_number']);
  card.setConfig({series_show_season_episode:false,series_show_season:true});
  assert.equal(card._config.series_show_season,true);
  assert.equal(card._config.series_show_episode_number,false);
});

test('bandwidth shows all, LAN or WAN only when manually classifiable', () => {
  const {card}=setup();
  const alice={id:'a',server_id:'srv',server_name:'Plex',server_type:'plex',username:'Alice',bitrate:6000,
    media_title:'Film',media_type:'movie',duration_ms:10000,progress_ms:0};
  const bob={...alice,id:'b',server_type:'jellyfin',username:'Bob',device:'Apple TV',bitrate:2000};
  const unknown={...alice,id:'c',server_type:'emby',username:'Carol',device:'Unknown',bitrate:1000};
  card._config={...card._config,show_bitrate:true,header_show_bandwidth:true,
    network_locations:'plex:Alice=remote\ndevice:Apple TV=local'};
  assert.equal(card._networkScope(alice),'remote');
  assert.equal(card._networkScope(bob),'local');
  assert.equal(card._networkScope(unknown),'unknown');
  assert.match(card._header([alice,bob,unknown]),/Bitrate : 9.0 Mb\/s/);
  card._config.bitrate_scope='remote';
  assert.match(card._header([alice,bob,unknown]),/Remote bitrate : 6.0 Mb\/s/);
  assert.match(card._streamCard(null,alice),/6\.0 Mb\/s/);
  assert.doesNotMatch(card._streamCard(null,bob),/2\.0 Mb\/s/);
  assert.doesNotMatch(card._streamCard(null,unknown),/1\.0 Mb\/s/);
  card._config.bitrate_scope='local';
  assert.match(card._header([alice,bob,unknown]),/Local bitrate : 2.0 Mb\/s/);
  assert.doesNotMatch(card._streamCard(null,alice),/6\.0 Mb\/s/);
  assert.match(card._streamCard(null,bob),/2\.0 Mb\/s/);
  card._config.network_locations='';
  assert.match(card._header([alice,bob,unknown]),/Local bitrate : 0.0 Mb\/s/);
});

test('arbitrary Home Assistant sensor, counter and units are safely shown as header badges', () => {
  const {card}=setup();
  card._config={...card._config,header_entity_badges:[
    {entity:'counter.overseer_demande',label:'Demandes'},
    {entity:'sensor.puissance',label:''},
    {entity:'sensor.inconnu',label:'Autre'},
    {entity:'sensor.invalid<script>',label:'Intrusion'}
  ]};
  card._hass={states:{
    'counter.overseer_demande':{state:'4',attributes:{friendly_name:'Demande Seerr'}},
    'sensor.puissance':{state:'870',attributes:{friendly_name:'PAC <salon>',unit_of_measurement:'W'}},
  }};
  const html=card._header([]);
  assert.match(html,/Demandes : 4/);
  assert.match(html,/PAC &lt;salon&gt; : 870 W/);
  assert.match(html,/Autre : Unavailable/);
  assert.doesNotMatch(html,/Intrusion/);
});

test('new Home Assistant state update refreshes only the header, preserving the carousel shell', () => {
  const {card}=setup();
  const entry={id:'entry',streams:[]};
  card._payload={entries:[entry]};
  card._config.header_entity_badges=[{entity:'counter.demande',label:'Demandes'}];
  card.render();
  let called=0;
  card._refreshHeader=(streams)=>{called++;assert.equal(streams.length,0);};
  const before=card.shadowRoot.renders;
  card.hass={states:{'counter.demande':{state:'2',attributes:{}}}};
  assert.equal(called,1);
  assert.equal(card.shadowRoot.renders,before);
  card.hass={states:{'counter.demande':{state:'3',attributes:{}}}};
  assert.equal(called,2);
});

test('empty state offers a custom message, header only or completely hidden card', () => {
  const {card}=setup();
  card._payload={entries:[{id:'entry',connected:true,streams:[],servers:[]}]};
  card._config={...card._config, empty_mode:'message',empty_message:'Tout le monde dort !'};
  card.render();
  assert.match(card.shadowRoot.innerHTML,/Tout le monde dort !/);
  card._config.empty_mode='header_only';card._renderFingerprint=null;card.render();
  assert.match(card.shadowRoot.innerHTML,/Now playing/);
  assert.doesNotMatch(card.shadowRoot.innerHTML,/Tout le monde dort !/);
  card._config.empty_mode='hide';card._renderFingerprint=null;card.render();
  assert.equal(card.style.display,'none');
  card.setConfig({hide_empty:true});
  assert.equal(card._config.empty_mode,'hide');
  card.setConfig({hide_empty:true,empty_mode:'header_only'});
  assert.equal(card._config.empty_mode,'header_only');
});

test('new editor exposes entity picker, independent season options, network scope and empty behavior', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card',header_entity_badges:[{entity:'counter.overseer_demande',label:'Demandes'}]});
  const html=editor.shadowRoot.innerHTML;
  for(const key of ['series_show_season','series_show_episode_number','bitrate_scope','network_locations','empty_mode','empty_message'])
    assert.match(html,new RegExp(`data-field="${key}"`));
  assert.match(html,/ha-entity-picker data-badge-index="0"/);
  assert.match(html,/data-badge-label="0"/);
  assert.match(html,/data-badge-remove="0"/);
  assert.match(html,/data-badge-add/);
  assert.match(html,/When nothing is playing/);
  assert.match(html,/Local \/ remote bitrate/);
});

// 0.1.8: paired clocks, projected end-time, clearer video/audio pictograms and
// advanced per-entity dashboard metrics.
test('elapsed and remaining switch simultaneously and add up to displayed duration', () => {
  time=0;
  const {card}=setup();
  const duration=120250;
  const clock={progress:61540,at:0,state:'playing',duration,lastRendered:61540};
  card._positions.set('clock',clock);
  const elapsed={dataset:{id:'clock'},textContent:''};
  const remaining={dataset:{id:'clock'},textContent:''};
  const fill={style:{}};
  const end={dataset:{id:'clock'},textContent:''};
  card.shadowRoot.querySelectorAll = selector => selector === '.time-current[data-id]' ? [elapsed] : [];
  card.shadowRoot.querySelector = selector => selector.includes('.time-remaining') ? remaining :
    selector.includes('.fill[') ? fill : selector.includes('.time-end') ? end : null;
  card._updateProgress();
  assert.equal(elapsed.textContent,'1:01');
  assert.equal(remaining.textContent,'-1:00');
  assert.match(end.textContent,/Ends at \d{1,2}:\d{2} [AP]M/);
  const firstPair=[elapsed.textContent,remaining.textContent];
  time=400;card._updateProgress();
  assert.deepEqual([elapsed.textContent,remaining.textContent],firstPair);
  time=500;card._updateProgress();
  assert.equal(elapsed.textContent,'1:02');
  assert.equal(remaining.textContent,'-0:59');
  assert.ok(fill.style.width.endsWith('%'));
  time=1600;card._updateProgress();
  assert.equal(elapsed.textContent,'1:03');
  assert.equal(remaining.textContent,'-0:58');
});

test('finish time independently appears in playing streams but not paused ones', () => {
  const {card}=setup();
  card._config={...card._config,show_progress:false,show_end_time:true,show_poster:false,show_avatar:false};
  const stream={id:'x',username:'Test',server_type:'plex',media_title:'Film',media_type:'movie',
    state:'playing',progress_ms:120000,duration_ms:3600000,started_at:'2026-11-03T18:00:00'};
  let html=card._streamCard(null,stream);
  assert.match(html,/Ends at \d{1,2}:\d{2} [AP]M/);
  assert.doesNotMatch(html,/class="progress"/);
  html=card._streamCard(null,{...stream,state:'paused'});
  assert.doesNotMatch(html,/Estimated end/);
  assert.match(html,/Paused/);
  card._config.show_end_time=false;
  html=card._streamCard(null,stream);
  assert.doesNotMatch(html,/Estimated end/);
});

test('new icons are a clapperboard with play triangle and speaker with sound waves', () => {
  const {card}=setup();
  card._config={...card._config,show_poster:false,show_avatar:false};
  const html=card._streamCard(null,{id:'x',username:'Test',server_type:'plex',media_title:'Test',
    media_type:'movie',state:'playing',progress_ms:0,duration_ms:10000,
    video_decision:'directplay',audio_decision:'transcode'});
  assert.match(html,/viewBox="0 0 24 24"/);
  assert.match(html,/m9\.5 11\.8 5\.7 3/);
  assert.match(html,/M3 9h4\.2L12\.8 4/);
});

test('header badges: zero color, hide zero, and blink only for positive values', () => {
  const {card}=setup();
  card._config={...card._config,header_show_video:true,header_show_streams:true,
    header_blink_positive:true,header_blink_seconds:1.5,
    header_zero_color_mode:'custom',header_zero_custom_color:'#102030'};
  let html=card._header([]);
  assert.match(html,/--pill-bg:#102030;--pill-text:#FFFFFF/);
  assert.doesNotMatch(html,/class="metric blink-positive"/);
  card._config.header_positive_only=true;
  html=card._header([]);
  assert.doesNotMatch(html,/class="metric/);
  card._config.header_positive_only=false;
  html=card._header([{id:'a',state:'playing',server_id:'plex',server_type:'plex',server_name:'Plex',video_decision:'transcode',audio_decision:'directplay'}]);
  assert.match(html,/class="metric blink-positive"/);
  assert.match(html,/--badge-blink:1\.5s/);
  assert.match(html,/Video : 1/);
});

test('entity badge permits icon-only, individual duration, and selective visibility', () => {
  const {card}=setup();
  card._config={...card._config,header_show_streams:false,header_entity_badges:[
    {entity:'counter.seerr',label:'Demandes',show_name:false,show_icon:true,
      only_positive:true,blink_positive:true,blink_seconds:3},
    {entity:'sensor.salon',label:'Salon',show_name:true,show_icon:false,only_positive:false,
      zero_color_mode:'custom',zero_custom_color:'#234567'},
  ]};
  card._hass={states:{
    'counter.seerr':{state:'4',attributes:{icon:'mdi:bell-badge',friendly_name:'Demandes'}},
    'sensor.salon':{state:'0',attributes:{friendly_name:'Salon'}},
  }};
  let html=card._header([]);
  assert.match(html,/ha-icon icon="mdi:bell-badge"/);
  assert.doesNotMatch(html,/Demandes : 4/);
  assert.match(html,/--badge-blink:3s/);
  assert.match(html,/Salon : 0/);
  assert.match(html,/--pill-bg:#234567/);
  card._hass.states['counter.seerr'].state='0';
  html=card._header([]);
  assert.doesNotMatch(html,/mdi:bell-badge/);
  assert.match(html,/Salon : 0/);
});

test('card editor exposes end time and advanced entity badge options', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card',header_entity_badges:[{entity:'counter.seerr',label:'Demandes'}]});
  const html=editor.shadowRoot.innerHTML;
  for(const key of ['show_end_time','header_positive_only','header_blink_positive',
      'header_blink_seconds','header_zero_color_mode','header_zero_custom_color','header_show_names'])
    assert.match(html,new RegExp(`data-field="${key}"`));
  for(const key of ['show_name','show_icon','only_positive','blink_positive',
    'blink_seconds','zero_color_mode','zero_custom_color'])
    assert.match(html,new RegExp(`data-badge-setting="${key}"`));
});

// 0.1.9: global LAN/WAN device mapping and reorderable header/footer fields.
test('device location defaults to integration settings with card-level overrides', () => {
  const {card}=setup();
  card._payload={entries:[{id:'integration-1',network_locations:{'server-1:device:Shield':'remote','device:Apple TV':'local','player:Plex Web':'remote'},streams:[]}]};
  const shield={server_id:'server-1', server_type:'plex',username:'alice',device:'Shield',bitrate:12000};
  const apple={server_id:'server-1', server_type:'plex',username:'alice',device:'Apple TV',bitrate:4000};
  assert.equal(card._networkScope(shield),'remote');
  assert.equal(card._networkScope(apple),'local');
  card._config.bitrate_scope='remote';
  assert.equal(card._includeBitrate(shield),true);
  assert.equal(card._includeBitrate(apple),false);
  card._config.network_locations='device:Shield=local';
  assert.equal(card._networkScope(shield),'local', 'card-specific rule wins over server-scoped global rule');
  card._config.network_locations='server-1:device:Shield=local';
  assert.equal(card._networkScope(shield),'local');
  // A card override does not mutate the global integration settings.
  assert.equal(card._payload.entries[0].network_locations['server-1:device:Shield'],'remote');
  card._config.network_locations='';
  assert.equal(card._networkScope(shield),'remote');
});

test('header order applies to metrics, HA badges, and maintains server counts as a group',()=>{
  const {card}=setup();
  card.setConfig({header_show_streams:true,header_show_bandwidth:true,header_show_video:true,header_show_server_counts:true,
    header_entity_badges:[{entity:'counter.seerr',label:'Demandes'}],
    header_badge_order:'entity:legacy-0,server_counts,video,streams,bandwidth'});
  card._hass={states:{'counter.seerr':{state:'5',attributes:{friendly_name:'Demandes'}}}};
  const streams=[
    {server_id:'p',server_name:'Plex',server_type:'plex',state:'playing',bitrate:2000,video_decision:'transcode',audio_decision:'copy'},
    {server_id:'j',server_name:'Jellyfin',server_type:'jellyfin',state:'playing',bitrate:1500,video_decision:'directplay',audio_decision:'directplay'},
  ];
  const html=card._header(streams);
  const pos=fragment=>html.indexOf(fragment);
  assert.ok(pos('Demandes : 5')<pos('Plex : 1'));
  assert.ok(pos('Plex : 1')<pos('Jellyfin : 1'));
  assert.ok(pos('Jellyfin : 1')<pos('Video : 1'));
  assert.ok(pos('Video : 1')<pos('2 streams'));
  assert.ok(pos('2 streams')<pos('Bitrate : 3.5 Mb/s'));
});

test('footer order controls visible server, device and quality fields',()=>{
  const {card}=setup();
  card._config={...card._config,show_poster:false,show_avatar:false,show_quality:true,
    show_server:true,show_device:true,show_bitrate:true,footer_field_order:'quality,bitrate,device,server,codecs,health'};
  const item={id:'a',media_title:'Film',media_type:'movie',username:'x',server_id:'p',server_name:'Plex',server_type:'plex',
    device:'Apple TV',resolution:'4K',bitrate:5000,state:'playing',progress_ms:0,duration_ms:100000};
  const html=card._streamCard(null,item);
  assert.ok(html.indexOf('>4K</span>')<html.indexOf('5.0 Mb/s'));
  assert.ok(html.indexOf('5.0 Mb/s')<html.indexOf('Apple TV'));
  // The server appears both as CSS token and visually: compare footer markup only.
  assert.ok(html.indexOf('Apple TV')<html.indexOf('>Plex</span>'));
});

test('editor exposes unified move buttons for header metrics, HA badges and footer fields',()=>{
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card',header_entity_badges:[{entity:'counter.seerr',label:'Demandes'}]});
  const html=editor.shadowRoot.innerHTML;
  assert.match(html,/data-order="header_badge_order"/);
  assert.match(html,/data-order="footer_field_order"/);
  assert.match(html,/Entity: Demandes/);
  assert.match(html,/Stream bitrate/);
});


test('elapsed and remaining are adjacent at left, estimated ending is separately aligned right', () => {
  const {card} = setup();
  card._config = {...card._config, show_poster:false, show_avatar:false,
    show_end_time:true, show_remaining:true, show_progress:true};
  const html = card._streamCard(null, {id:'clock1',username:'Alice', server_type:'plex',
    media_title:'Test', media_type:'movie',state:'playing',progress_ms:60000,
    duration_ms:180000});
  assert.match(html, /class="time-left">[\s\S]*class="time-current"[\s\S]*class="time-separator">\/[\s\S]*class="time-remaining"/);
  assert.match(html, /<\/span><span class="time-end" data-id="clock1">Ends at \d{1,2}:\d{2} [AP]M<\/span><\/div>/);
  assert.doesNotMatch(html, /time-right|Estimated end/);
});

test('paused stream displays Paused beside elapsed and no predicted end', () => {
  const {card} = setup();
  card._config = {...card._config, show_poster:false, show_avatar:false,show_end_time:true};
  const html = card._streamCard(null, {id:'pause1',username:'Alice',server_type:'plex',
    media_title:'Film',media_type:'movie',state:'paused',progress_ms:60000,duration_ms:180000});
  assert.match(html, /class="time-left">[\s\S]*class="time-current"[\s\S]*class="time-paused">Paused/);
  assert.doesNotMatch(html, /class="time-end"/);
});


test('individual card offers active session selection and durable account/server targeting', () => {
  const Individual=classes.get('tracearr-stream-card');
  const individual=new Individual();
  const entry={id:'server-config',name:'Tracearr',streams:[
    {id:'session-a',server_id:'plex-id',username:'alice',server_name:'Plex',media_title:'Film A',started_at:'2026-11-04T10:00:00Z'},
    {id:'session-b',server_id:'jelly-id',username:'bob',server_name:'Jellyfin',media_title:'Film B',started_at:'2026-11-04T11:00:00Z'},
  ],servers:[{server_id:'plex-id',server_name:'Plex'},{server_id:'jelly-id',server_name:'Jellyfin'}]};
  individual._payload={entries:[entry]};
  individual.setConfig({type:'custom:tracearr-stream-card', selection:'account',selected_account:'plex-id:alice'});
  assert.equal(individual._streams(entry)[0].id,'session-a');
  individual.setConfig({type:'custom:tracearr-stream-card', selection:'server',selected_server:'jelly-id'});
  assert.equal(individual._streams(entry)[0].id,'session-b');
  individual.setConfig({type:'custom:tracearr-stream-card', selection:'stream',stream_id:'session-a'});
  assert.equal(individual._streams(entry)[0].id,'session-a');
  individual.setConfig({type:'custom:tracearr-stream-card', selection:'account',selected_account:''});
  assert.equal(individual._streams(entry).length,0,'an unset target must not display unrelated streams');
  individual.setConfig({type:'custom:tracearr-stream-card', selection:'stream',stream_id:'session-b',filter_user:'alice'});
  assert.equal(individual._streams(entry)[0].id,'session-b','explicit target ignores stale user filter');
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor._payload={entries:[entry]};
  editor.setConfig({type:'custom:tracearr-stream-card'});
  const html=editor.shadowRoot.innerHTML;
  assert.match(html,/value="session-a"/);
  assert.match(html,/value="plex-id:alice"/);
  assert.match(html,/data-field="selection"/);
  assert.match(html,/data-field="selected_account"/);
  assert.match(html,/data-field="selected_server"/);
  assert.match(html,/data-field="stream_id"/);
});

test('entity badge options are collapsed by default with nested detail sections', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card',header_entity_badges:[{id:'request',entity:'sensor.seerr_requests',label:'Seerr'}]});
  const html=editor.shadowRoot.innerHTML;
  assert.match(html,/data-subdetail="entity-request"/);
  assert.match(html,/Seerr/);
  assert.match(html,/data-badge-setting="blink_positive"/);
  assert.match(html,/data-badge-setting="zero_custom_color"/);
});


test('server-wide LAN/WAN default applies to future clients and respects explicit exceptions', () => {
  const {card}=setup();
  card._payload={entries:[{id:'entry',network_locations:{
    'server:plex-id':'remote',
    'plex-id:device:Shield':'local',
    'device:Unscoped':'local',
  },streams:[]}]};
  card._config={...card._config,entry_id:'entry'};
  const stream=(device)=>({server_id:'plex-id',server_name:'Plex Maison',server_type:'plex',username:'Alice',device});
  assert.equal(card._networkScope(stream('Shield')),'local', 'server-scoped device overrides server default');
  assert.equal(card._networkScope(stream('New player')),'remote', 'new device inherits server rule');
  assert.equal(card._networkScope(stream('Unscoped')),'remote', 'explicit server rule beats old generic rule');
  card._config.network_locations='device:Unscoped=local';
  assert.equal(card._networkScope(stream('Unscoped')),'local', 'card override wins');
});

test('server-wide rule supports explicit unclassified device exception', () => {
  const {card}=setup();
  card._payload={entries:[{id:'entry',network_locations:{
    'server:plex-id':'local', 'plex-id:device:Guest TV':'unknown',
  },streams:[]}]};
  card._config={...card._config,entry_id:'entry'};
  assert.equal(card._networkScope({server_id:'plex-id',device:'Guest TV',username:'guest',server_type:'plex'}),'unknown');
  assert.equal(card._networkScope({server_id:'plex-id',device:'Living TV',username:'guest',server_type:'plex'}),'local');
});

test('poster size scales artwork in standard and compact cards without changing Sections sizing', () => {
  const {card}=setup();
  card.setConfig({poster_size:150});
  assert.equal(card._config.poster_size,150);
  card.render();
  const html=card.shadowRoot.innerHTML;
  assert.match(html,/--tr-poster-width:110px;--tr-poster-height:164px;--tr-compact-poster-width:72px;--tr-compact-poster-height:108px/);
  assert.match(html,/\.poster-wrap \{[^}]*width:var\(--tr-poster-width,73px\)/s);
  assert.match(html,/\.compact \.poster-wrap \{[^}]*width:var\(--tr-compact-poster-width,48px\)/s);
  card.setConfig({poster_size:999,compact:true});
  assert.equal(card._config.poster_size,200,'poster size is clamped');
  card.render();
  assert.match(card.shadowRoot.innerHTML,/--tr-poster-width:146px;--tr-poster-height:218px;--tr-compact-poster-width:96px;--tr-compact-poster-height:144px/);
  card.setConfig({});
  assert.equal(card._config.poster_size,100,'old dashboard cards retain their original poster size');
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  editor.setConfig({type:'custom:tracearr-streams-card'});
  assert.match(editor.shadowRoot.innerHTML,/data-field="poster_size" value="100"/);
  editor.setConfig({type:'custom:tracearr-stream-card',poster_size:125});
  assert.match(editor.shadowRoot.innerHTML,/data-field="poster_size" value="125"/);
});

test('header badges move left when title is hidden, and stay right when shown', () => {
  const {card}=setup();
  card.setConfig({show_header:true,show_title:false,header_show_streams:true});
  assert.match(card._header([]),/<header class="head no-title"><div class="head-metrics">/);
  card.render();
  assert.match(card._header([]),/class="head-group align-left"><span class="metric/);
  assert.match(card.shadowRoot.innerHTML,/\.head-metrics \{ display:flex;/);
  card._config.show_title=true;
  assert.match(card._header([]),/<header class="head"><h3>Now playing<\/h3><div class="head-metrics">/);
  assert.match(card._header([]),/class="head-group align-right"><span class="metric/);
});

test('a signed poster appears as soon as its URL resolves, without rebuilding the carousel', async () => {
  const {card}=setup({count:1});
  const stream={id:'stream-poster',poster_url:'/api/v1/images/proxy?key=poster',username:'Alice'};
  const entry={id:'entry-poster',streams:[stream]};
  card._payload={entries:[entry]};
  let replacement='';
  const placeholder={tagName:'DIV',set outerHTML(value){replacement=value;}};
  const node={dataset:{session:stream.id},querySelector(sel){
    return sel === '.poster-wrap .poster' ? placeholder : null;
  }};
  card.shadowRoot.querySelectorAll=sel=>sel === '.stream' ? [node] : [];
  card._hass={connection:{sendMessagePromise:async()=>({path:'/api/tracearr_ha/image/entry-poster/stream-poster/poster?authSig=signed'})}};
  const before=card.shadowRoot.renders;
  assert.equal(card._image(entry,stream,'poster'),'');
  assert.equal(card._image(entry,stream,'poster'),'','pending URL must not become undefined image src');
  await Promise.resolve();
  await Promise.resolve();
  assert.match(replacement,/data-kind="poster"/);
  assert.match(replacement,/authSig=signed/);
  assert.equal(card.shadowRoot.renders,before,'signed URL must not rebuild the carousel');
});

test('failed signed image is replaced by fallback and retried with a new signature', async () => {
  const {card}=setup();
  const stream={id:'broken-poster',poster_url:'/api/v1/images/proxy?key=poster',username:'Alice'};
  const entry={id:'entry-retry',streams:[stream]};
  card._payload={entries:[entry]};
  let requests=0, applied=0, fallback='';
  card._hass={connection:{sendMessagePromise:async()=>{
    requests++;
    if (requests === 1) throw Error('temporary auth error');
    return {path:'/api/tracearr_ha/image/entry-retry/broken-poster/poster?authSig=renewed'};
  }}};
  card._applyArtwork=()=>applied++;
  card._image(entry,stream,'poster');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(card._imageAttempts.get(card._artworkPath(entry,stream,'poster')),1);
  assert.equal(card._imageRetryTimers.size,1);
  const timer=[...artworkTimers.values()][0];
  assert.equal(timer.delay,2000);
  timer.fn();artworkTimers.clear();
  await Promise.resolve();await Promise.resolve();
  assert.equal(requests,2);
  assert.equal(applied,1);
  assert.match(card._images.get(card._artworkPath(entry,stream,'poster')).url,/authSig=renewed/);
  const img={
    getAttribute(key){return key==='data-kind'?'poster':'/api/tracearr_ha/image/entry-retry/broken-poster/poster?authSig=renewed';},
    closest(){return {dataset:{session:stream.id}};},
    set outerHTML(value){fallback=value;}
  };
  card._onArtworkError({target:img});
  assert.match(fallback,/poster empty/);
  assert.equal(card._imageAttempts.get(card._artworkPath(entry,stream,'poster')),2);
  assert.equal([...artworkTimers.values()][0].delay,5000);
  card.disconnectedCallback();
  assert.equal(artworkTimers.size,0,'pending retry canceled when card disconnects');
});

test('successful image load resets the retry budget', () => {
  const {card}=setup();
  const stream={id:'s',poster_url:'/api/v1/images/proxy?x=1'};
  const entry={id:'e',streams:[stream]};
  card._payload={entries:[entry]};
  const path=card._artworkPath(entry,stream,'poster');
  card._imageAttempts.set(path,2);
  const img={getAttribute:key=>key==='data-kind'?'poster':null,closest:()=>({dataset:{session:'s'}})};
  card._onArtworkLoad({target:img});
  assert.equal(card._imageAttempts.has(path),false);
});

test('cinematic stream surface renders blurred artwork underneath readable content', () => {
  const {card}=setup();
  const entry={id:'instance',servers:[]};
  const stream={id:'movie-1',username:'alice',server_type:'plex',media_title:'Film',media_type:'movie',
    state:'paused',progress_ms:12000,duration_ms:45000,poster_url:'/api/v1/images/proxy?poster=1'};
  card._image=(_,__,kind)=>kind==='poster'?'https://example.test/movie-poster.jpg':'';
  card.setConfig({stream_surface:'blur',stream_blur:30,stream_overlay:64,
    stream_accent_width:6,stream_accent_style:'rounded'});
  const html=card._streamCard(entry,stream);
  assert.match(html,/class="stream accent-rounded surface-blur"/);
  assert.match(html,/--tr-stream-blur:30px;--tr-stream-overlay:0\.64;--tr-edge-width:6px/);
  assert.match(html,/class="stream-backdrop" aria-hidden="true"/);
  assert.match(html,/class="backdrop-image" src="https:\/\/example\.test\/movie-poster\.jpg"/);
  assert.match(html,/class="poster" data-kind="poster"/);
  assert.match(html,/class="poster-paused"/);
  card.render();
  assert.match(card.shadowRoot.innerHTML,/\.stream-backdrop .backdrop-image \{/);
  assert.match(card.shadowRoot.innerHTML,/\.stream::before \{[^}]*border-left:var\(--tr-edge-width,4px\) solid/s);
  assert.match(card.shadowRoot.innerHTML,/\.stream > \.poster-wrap, \.stream > \.info \{ position:relative; z-index:1; \}/);
  assert.match(card.shadowRoot.innerHTML,/\.stream > \.media-flags \{ z-index:2; \}/);
});

test('legacy surface remains unchanged, and missing poster never leaves broken background', () => {
  const {card}=setup();
  card._image=()=>'';
  const stream={id:'a',username:'alice',server_type:'jellyfin',media_title:'Film',media_type:'movie',
    state:'playing',progress_ms:0,duration_ms:10000};
  card.setConfig({});
  assert.equal(card._config.stream_surface,'soft');
  assert.equal(card._config.stream_accent_style,'rounded');
  assert.doesNotMatch(card._streamCard(null,stream),/stream-backdrop/);
  card.setConfig({stream_surface:'blur',show_poster:false,stream_accent_style:'none'});
  let html=card._streamCard(null,stream);
  assert.match(html,/class="stream accent-none surface-blur"/);
  assert.match(html,/class="backdrop-empty"/);
  assert.doesNotMatch(html,/<img class="poster"/);
  card.setConfig({stream_surface:'blur',stream_blur:999,stream_overlay:-50,
    stream_accent_width:999,stream_accent_style:'invalid'});
  assert.equal(card._config.stream_blur,50);
  assert.equal(card._config.stream_overlay,25);
  assert.equal(card._config.stream_accent_width,8);
  assert.equal(card._config.stream_accent_style,'rounded');
  card.setConfig({stream_surface:'transparent',stream_accent_style:'straight'});
  html=card._streamCard(null,stream);
  assert.match(html,/class="stream accent-straight"/);
  assert.doesNotMatch(html,/stream-backdrop/);
});

test('visual editor offers blur intensity, darkening and rounded edge styling for both cards', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  for (const type of ['custom:tracearr-streams-card','custom:tracearr-stream-card']) {
    editor.setConfig({type,stream_surface:'blur',stream_blur:32,stream_overlay:62,stream_accent_width:5});
    const html=editor.shadowRoot.innerHTML;
    assert.match(html,/value="blur">Blurred poster \(cinema\)/);
    assert.match(html,/data-field="stream_blur" value="32"/);
    assert.match(html,/data-field="stream_overlay" value="62"/);
    assert.match(html,/data-field="stream_accent_style"/);
    assert.match(html,/data-field="stream_accent_width" value="5"/);
  }
});

test('late signed poster updates both blurred background and visible poster without rebuilding', () => {
  const {card}=setup({count:1});
  const stream={id:'s1',poster_url:'/api/v1/images/proxy?test=1',username:'Alice'};
  const entry={id:'e1',streams:[stream]};
  card._payload={entries:[entry]};
  card.setConfig({stream_surface:'blur',show_poster:false});
  let backdropUpdated='';
  const backdrop={tagName:'DIV',set outerHTML(html){backdropUpdated=html;}};
  const node={dataset:{session:'s1'},querySelector(selector) {
    return selector.includes('.stream-backdrop .backdrop-image') ? backdrop : null;
  }};
  card.shadowRoot.querySelectorAll=selector=>selector==='.stream'?[node]:[];
  const before=card.shadowRoot.renders;
  card._applyArtwork('s1','poster','/api/tracearr_ha/image/e1/s1/poster?authSig=good');
  assert.match(backdropUpdated,/class="backdrop-image" data-kind="poster"/);
  assert.match(backdropUpdated,/authSig=good/);
  assert.equal(card.shadowRoot.renders,before);
  card._config.show_poster=true;
  card._applyArtwork('s1','poster','/api/tracearr_ha/image/e1/s1/poster?authSig=new');
  assert.doesNotMatch(backdropUpdated,/data-kind="poster"/);
});

test('poster failure removes broken blurred background and schedules retries', () => {
  const {card}=setup();
  const stream={id:'s1',poster_url:'/api/v1/images/proxy?img=1',username:'Alice'};
  const entry={id:'e1',streams:[stream]};
  card._payload={entries:[entry]};
  card.setConfig({stream_surface:'blur',show_poster:true});
  let posterFallback='',backdropFallback='';
  const backdrop={set outerHTML(value){backdropFallback=value;}};
  const parent={dataset:{session:'s1'},querySelector(){return backdrop;}};
  const img={
    getAttribute: key=>key==='data-kind'?'poster':'signed',
    closest:()=>parent,
    set outerHTML(value){posterFallback=value;}
  };
  card._images.set(card._artworkPath(entry,stream,'poster'),{url:'signed'});
  card._onArtworkError({target:img});
  assert.match(posterFallback,/poster empty/);
  assert.match(backdropFallback,/backdrop-empty/);
  assert.equal(card._imageRetryTimers.size,1);
  card.disconnectedCallback();
});

test('statistic and Home Assistant badges can independently choose left, center or right', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false,show_header:true,
    header_show_streams:true,header_show_bandwidth:true,header_show_video:true,
    header_badge_order:'entity:legacy-0,streams,entity:legacy-1,video,bandwidth',
    header_entity_badges:[
      {entity:'counter.request',label:'Demandes',align:'left'},
      {entity:'sensor.storage',label:'Disque',align:'right'},
    ],
    header_metric_settings:{
      streams:{align:'left'},
      video:{align:'center'},
      bandwidth:{align:'right'},
    },
  });
  card._hass={states:{
    'counter.request':{state:'2',attributes:{}},
    'sensor.storage':{state:'38',attributes:{unit_of_measurement:'%'}},
  }};
  const streams=[{id:'s',state:'playing',video_decision:'transcode',audio_decision:'copy',bitrate:4500}];
  const header=card._header(streams);
  const getGroup=align => header.match(new RegExp('class="head-group align-'+align+'">([\\s\\S]*?)<\\/div>'))?.[1]||'';
  assert.ok(getGroup('left').includes('Demandes : 2'));
  assert.ok(getGroup('left').includes('1 stream'));
  assert.ok(getGroup('left').indexOf('Demandes : 2') < getGroup('left').indexOf('1 stream'));
  assert.ok(getGroup('center').includes('Video : 1'));
  assert.ok(getGroup('right').includes('Disque : 38 %'));
  assert.ok(getGroup('right').includes('Bitrate : 4.5 Mb/s'));
  assert.ok(getGroup('right').indexOf('Disque : 38 %') < getGroup('right').indexOf('Bitrate : 4.5 Mb/s'));
  assert.doesNotMatch(getGroup('left'),/Bitrate :/);
  card._config.show_title=true;
  assert.ok(getGroup('left').includes('1 stream')); // explicit alignment unaffected by title
  const shown=card._header(streams);
  assert.match(shown,/<h3>Now playing<\/h3>/);
  assert.match(shown,/class="head-group align-left">[\s\S]*?1 stream/);
});

test('per-statistic style works like entity badges, including icon/name, zero color and blink', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false,header_show_names:false,
    header_show_streams:false,header_show_bandwidth:false,header_show_audio:true,
    header_show_video:true,header_show_transcodes_total:true,
    header_metric_settings:{
      audio:{show_name:true,show_icon:true,zero_color_mode:'custom',zero_custom_color:'#202020',label:'Son',align:'center'},
      video:{show_name:false,show_icon:true,icon:'mdi:movie-open',blink_positive:true,blink_seconds:1.5,align:'right'},
      transcodes_total:{only_positive:true},
    },
  });
  let html=card._header([]);
  assert.match(html,/Son : 0/);
  assert.match(html,/icon="mdi:music-note"/);
  assert.match(html,/--pill-bg:#202020;--pill-text:#FFFFFF/);
  assert.doesNotMatch(html,/Transcodes : 0/);
  const streams=[{id:'video',state:'playing',video_decision:'transcode',audio_decision:'copy'}];
  html=card._header(streams);
  assert.match(html,/icon="mdi:movie-open"/);
  assert.match(html,/--badge-blink:1.5s/);
  assert.match(html,/class="metric blink-positive"/);
  assert.doesNotMatch(html,/Video : 1/);
  assert.match(html,/Transcodes : 1|>1<\/span>/);
  assert.match(html,/Son : 0/);
});

test('per-badge settings sanitize alignment and icon and keep legacy defaults', () => {
  const {card}=setup();
  card.setConfig({});
  assert.equal(Object.keys(card._config.header_metric_settings).length,0);
  assert.equal(card._header([]).includes('class="head-group align-right"><span class="metric'),true);
  card.setConfig({show_title:false,
    header_metric_settings:{
      video:{align:'middle',show_icon:true,icon:'mdi:movie" onclick="bad',show_name:false},
      unknown:{align:'left'},
    },
    header_entity_badges:[{entity:'counter.alice',align:'nope',label:'Alice'}],
  });
  assert.equal(card._config.header_metric_settings.video.align,'auto');
  assert.equal(card._config.header_metric_settings.video.icon,'');
  assert.equal(card._config.header_metric_settings.unknown,undefined);
  assert.equal(card._config.header_entity_badges[0].align,'auto');
  card._config.header_show_video=true;
  assert.doesNotMatch(card._header([]),/onclick=/);
  assert.match(card._header([]),/icon="mdi:filmstrip"/);
  assert.match(card._header([]),/class="head-group align-left">/);
});

test('editor renders the same advanced style and alignment controls for both card types', () => {
  const Editor=classes.get('tracearr-card-editor');
  const editor=new Editor();
  for(const type of ['custom:tracearr-streams-card','custom:tracearr-stream-card']) {
    editor.setConfig({type,header_metric_settings:{video:{
      align:'center',show_icon:true,show_name:false,blink_seconds:1.5,icon:'mdi:movie',
      zero_color_mode:'custom',zero_custom_color:'#102030',
    }},header_entity_badges:[{id:'requests',entity:'counter.request',align:'right',label:'Demandes'}]});
    const html=editor.shadowRoot.innerHTML;
    assert.match(html,/data-subdetail="metric-video"/);
    for(const field of ['align','label','show_name','show_icon','only_positive','blink_positive','blink_seconds','zero_color_mode','zero_custom_color','icon']) {
      assert.match(html,new RegExp('data-metric-setting="'+field+'" data-metric-key="video"'));
    }
    assert.match(html,/data-metric-setting="align" data-metric-key="video"[\s\S]*?value="center" selected/);
    assert.match(html,/data-badge-setting="align" data-badge-index="0"[\s\S]*?value="right" selected/);
    assert.match(html,/data-metric-setting="zero_custom_color" data-metric-key="video" value="#102030"/);
    assert.match(html,/data-metric-setting="blink_seconds" data-metric-key="video" value="1.5"/);
    assert.match(html,/data-field="header_show_video"/);
    assert.match(html,/data-order="header_badge_order"/);
  }
});test('mobile: left and right badges share a row without reserving an empty center column', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false,header_show_streams:true,header_show_transcodes_total:true,
    header_show_bandwidth:true,header_entity_badges:[
      {id:'requests',entity:'counter.seerr',label:'Seerr',align:'right'},
    ],
    header_metric_settings:{
      streams:{align:'left'},transcodes_total:{align:'left'},bandwidth:{align:'right'},
    },
  });
  card._hass={states:{'counter.seerr':{state:'0',attributes:{}}}};
  const html=card._header([{id:'play',server_type:'plex',is_transcode:true,
    video_decision:'transcode',audio_decision:'copy',state:'playing',bitrate:1200}]);
  assert.match(html,/<div class="head-metrics"><div class="head-group align-left">/);
  assert.match(html,/class="head-group align-right">/);
  assert.doesNotMatch(html,/class="head-group align-center"/);
  assert.doesNotMatch(html,/class="head-metrics with-center"/);
  const before=html.indexOf('1 stream'),after=html.indexOf('Seerr : 0');
  assert.ok(before>=0 && after>before);
  card.render();
  const css=card.shadowRoot.innerHTML;
  assert.match(css,/\.head-metrics \{ display:flex;[^}]*flex-wrap:wrap;/s);
  assert.match(css,/\.head-group \{ display:flex; flex:0 1 auto;/);
  assert.match(css,/\.head-group\.align-right \{ justify-content:flex-end; margin-left:auto; \}/);
  assert.doesNotMatch(css,/\.head-group \{ flex:1 1 100%; \}/);
});

test('center columns are created only while a centered badge is visible', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false,header_show_streams:true,header_show_video:true,
    header_metric_settings:{streams:{align:'left'},video:{align:'center',only_positive:true}},
  });
  let html=card._header([]);
  assert.match(html,/<div class="head-metrics"><div class="head-group align-left">/);
  assert.doesNotMatch(html,/head-metrics with-center|head-group align-center/);
  html=card._header([{id:'a',video_decision:'transcode',audio_decision:'copy',state:'playing'}]);
  assert.match(html,/class="head-metrics with-center"/);
  assert.match(html,/class="head-group align-center">/);
  card.setConfig({
    show_title:false,header_show_streams:false,header_show_video:true,
    header_metric_settings:{video:{align:'center'}},
  });
  html=card._header([{id:'a',video_decision:'transcode',audio_decision:'copy',state:'playing'}]);
  assert.match(html,/class="head-metrics only-center"/);
  assert.doesNotMatch(html,/class="head-group align-left"|class="head-group align-right"/);
});

test('center badge uses only its intrinsic width while retaining perfect horizontal centering', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false, header_show_streams:true, header_show_bandwidth:true,
    header_entity_badges:[{id:'seerr',entity:'counter.seerr',label:'Seerr',align:'center'}],
    header_metric_settings:{streams:{align:'left'},bandwidth:{align:'right'}},
  });
  card._hass={states:{'counter.seerr':{state:'0',attributes:{}}}};
  const header=card._header([{id:'s',state:'playing',bitrate:2500}]);
  assert.match(header,/<div class="head-metrics with-center">/);
  assert.match(header,/class="head-group align-left">[\s\S]*?1 stream/);
  assert.match(header,/class="head-group align-center">[\s\S]*?Seerr : 0/);
  assert.match(header,/class="head-group align-right">[\s\S]*?Bitrate : 2.5 Mb\/s/);
  card.render();
  const css=card.shadowRoot.innerHTML;
  assert.match(css,/\.head-metrics\.with-center \{ display:grid;\s*grid-template-columns:minmax\(0,1fr\) max-content minmax\(0,1fr\); \}/);
  assert.doesNotMatch(css,/grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(css,/\.head-metrics\.with-center > \.align-center \{ grid-column:2; width:max-content;\s*max-width:100%; justify-self:center; justify-content:center; \}/);
  assert.match(css,/@container \(max-width:260px\) \{/);
  assert.doesNotMatch(css,/@container \(max-width:440px\) \{/);
  assert.match(css,/\.head-metrics\.with-center > \.align-center \{ order:3; flex:1 1 100%;\s*width:100%; margin-inline:0; justify-content:center; \}/);
});

test('center track remains absent when no badge is centered', () => {
  const {card}=setup();
  card.setConfig({show_title:false,header_show_streams:true,header_show_bandwidth:true,
    header_metric_settings:{streams:{align:'left'},bandwidth:{align:'right'}}});
  assert.match(card._header([]),/class="head-metrics"/);
  assert.doesNotMatch(card._header([]),/with-center|head-group align-center/);
  card.setConfig({show_title:false,header_show_streams:false,header_show_bandwidth:true,
    header_metric_settings:{bandwidth:{align:'center'}}});
  assert.match(card._header([]),/class="head-metrics only-center"/);
  assert.doesNotMatch(card._header([]),/head-metrics with-center/);
});test('a left, center and right badge share one row at normal mobile widths', () => {
  const {card}=setup();
  card.setConfig({
    show_title:false,header_show_streams:true,header_show_bandwidth:true,
    header_entity_badges:[{id:'seerr',entity:'counter.seerr',label:'Seerr',align:'center'}],
    header_metric_settings:{streams:{align:'left'},bandwidth:{align:'right'}},
  });
  card._hass={states:{'counter.seerr':{state:'0',attributes:{}}}};
  const html=card._header([{id:'a',state:'playing',bitrate:2000}]);
  assert.match(html,/class="head-metrics with-center"/);
  assert.match(html,/class="head-group align-left"/);
  assert.match(html,/class="head-group align-center"/);
  assert.match(html,/class="head-group align-right"/);
  card.render();
  const css=card.shadowRoot.innerHTML;
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) max-content minmax\(0,1fr\)/);
  assert.match(css,/@container \(max-width:260px\)/);
  assert.doesNotMatch(css,/@container \(max-width:440px\)/);
});
