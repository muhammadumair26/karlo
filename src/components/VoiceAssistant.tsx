import { Keyboard, Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uid, type BoardActionBody } from '../lib/board';
import { CATEGORIES, CURRENCIES, fetchRate, INCOME_CATEGORIES, saveExpense, type ExpenseSettings } from '../lib/expenses';
import { boardSettings, type BoardData, type Me, type Person } from '../lib/types';
import { isNativeApp } from '../lib/platform';
import { parseVoice, type VoiceIntent } from '../lib/voiceParse';
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition';
import { showAlert } from './dialog';

type Intent = VoiceIntent;

// The browser's speech-to-text (Chrome, Edge, Safari). Not in every browser or app webview.
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const SpeechRec = (): (new () => Rec) | null =>
  ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition) ||
  null;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Floating mic: say (or type) what to add — a card, a cost or income — or a card to find. Understood on the device: free, no AI service. */
export function VoiceAssistant({
  boardId,
  data,
  people,
  me,
  canAddCards,
  money,
  dispatch,
  onOpenCard,
}: {
  boardId: string;
  data: BoardData;
  people: Person[];
  me: Me;
  canAddCards: boolean;
  money: ExpenseSettings | null;
  dispatch: (a: BoardActionBody) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [it, setIt] = useState<Intent | null>(null);
  const rec = useRef<Rec | null>(null);
  // In the iOS / Android app the phone's own speech recognition is used (plugin); on the web, the browser's.
  const supported = isNativeApp || !!SpeechRec();

  const lists = data.listOrder.map((id) => data.lists[id]).filter((l) => l && !l.archived);
  const listByName = (n: string) => lists.find((l) => l.title.toLowerCase() === n.toLowerCase());
  const personByName = (n: string) => people.find((p) => p.name.toLowerCase() === n.toLowerCase());

  const stop = () => {
    rec.current?.stop();
    if (isNativeApp) void NativeSpeech.stop().catch(() => {});
    setListening(false);
  };
  const reset = () => {
    stop();
    setText('');
    setIt(null);
    setErr(null);
    setBusy(false);
  };
  const close = () => {
    reset();
    setOpen(false);
    setTyping(false);
  };

  const listenNative = async () => {
    reset();
    try {
      const perm = await NativeSpeech.requestPermissions();
      if (perm.speechRecognition !== 'granted') {
        setErr('Microphone permission is off for Karlo. Turn it on in your phone settings, or type instead.');
        setTyping(true);
        return;
      }
      let latest = '';
      await NativeSpeech.removeAllListeners();
      await NativeSpeech.addListener('partialResults', (d) => {
        latest = d.matches?.[0] ?? latest;
        setText(latest);
      });
      await NativeSpeech.addListener('listeningState', (d) => {
        if (d.status === 'stopped') {
          setListening(false);
          void NativeSpeech.removeAllListeners();
          if (latest.trim()) void submit(latest.trim());
        }
      });
      setListening(true);
      await NativeSpeech.start({ language: navigator.language || 'en-US', partialResults: true, popup: false, maxResults: 1 });
    } catch (e) {
      setListening(false);
      setErr("Couldn't start listening. Try again or type instead.");
      console.error(e);
    }
  };

  const listen = () => {
    if (isNativeApp) return void listenNative();
    const R = SpeechRec();
    if (!R) {
      setTyping(true);
      return;
    }
    reset();
    const r = new R();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setText((finalText + ' ' + interim).trim());
    };
    r.onerror = (e) => {
      setListening(false);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') setErr('Microphone access is blocked. Allow it in your browser settings, or type instead.');
      else if (e?.error !== 'no-speech' && e?.error !== 'aborted') setErr("Couldn't hear that. Try again or type instead.");
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) void submit(finalText.trim());
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const submit = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = parseVoice(t, { lists: lists.map((l) => l.title), people: people.map((p) => p.name) });
      if (r.intent === 'add_card' && !canAddCards) {
        r.intent = 'unknown';
        r.reply = "You can't add cards on this board. Try “Find …” to search.";
      }
      // Fill sensible defaults the app knows best.
      if (r.intent === 'add_card' && !listByName(r.list)) r.list = lists[0]?.title ?? '';
      if (r.intent !== 'add_card' && r.intent !== 'unknown') {
        if (!money) {
          r.intent = 'unknown';
          r.reply = "Money tracking isn't on for you on this board.";
        } else {
          r.currency = CURRENCIES.includes(r.currency) ? r.currency : money.currency;
          r.date = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today();
        }
      }
      setIt(r);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  useEffect(
    () => () => {
      rec.current?.stop();
      if (isNativeApp) void NativeSpeech.stop().catch(() => {});
    },
    [],
  );

  const set = (p: Partial<Intent>) => it && setIt({ ...it, ...p });
  const found = (() => {
    if (!it || it.intent !== 'search') return [];
    const listOf = new Map<string, string>();
    for (const l of lists) for (const c of l.cardIds) listOf.set(c, l.title);
    const all = [...listOf.keys()].map((id) => data.cards[id]).filter((c) => c && !c.archived);
    if (it.query === '@me') return all.filter((c) => c.assignees.includes(me.id) || (!c.assignees.length && c.owners?.includes(me.id))).map((c) => ({ c, list: listOf.get(c.id)! })).slice(0, 30);
    const q = it.query.toLowerCase();
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    const inList = lists.find((l) => l.title.toLowerCase() === q.replace(/\s*(list|column)$/, ''));
    const scored = all
      .map((c) => {
        if (inList && listOf.get(c.id) === inList.title) return { c, score: 50 };
        const hay = `${c.title} ${c.description}`.toLowerCase();
        let score = c.title.toLowerCase().includes(q) ? 100 : 0;
        for (const w of words) if (hay.includes(w)) score += c.title.toLowerCase().includes(w) ? 10 : 3;
        else if (w.length > 3 && hay.includes(w.slice(0, -1))) score += 2;
        return { c, score };
      })
      .filter((x) => x.score >= Math.max(3, words.length * 3 - 3))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 30).map(({ c }) => ({ c, list: listOf.get(c.id)! }));
  })();
  const rules = boardSettings(data);
  const list = it ? listByName(it.list) : undefined;
  const needDue = !!it && it.intent === 'add_card' && (rules.requireDue || !!list?.requireDue) && !it.due;
  const needMember = !!it && it.intent === 'add_card' && rules.requireMember && !personByName(it.member);

  const confirm = async () => {
    if (!it) return;
    if (it.intent === 'add_card') {
      if (!list || !it.title.trim() || needDue || needMember) return;
      const cardId = uid();
      dispatch({
        type: 'ADD_CARD',
        listId: list.id,
        cardId,
        title: it.title.trim(),
        due: it.due || null,
        assignees: personByName(it.member) ? [personByName(it.member)!.user_id] : [],
      });
      if (it.description.trim()) dispatch({ type: 'UPDATE_CARD', cardId, patch: { description: it.description.trim() } });
      void showAlert({ title: 'Card added', message: `“${it.title.trim()}” is in ${list.title}.`, tone: 'access' });
      close();
    } else if (money && (it.intent === 'add_expense' || it.intent === 'add_income')) {
      if (!(it.amount > 0)) return;
      setBusy(true);
      try {
        const foreign = it.currency !== money.currency;
        const rate = foreign ? await fetchRate(it.currency, money.currency) : 1;
        if (!rate) throw new Error(`Couldn't get today's ${it.currency} rate. Add it from the Money page instead.`);
        await saveExpense(boardId, {
          kind: it.intent === 'add_income' ? 'income' : 'expense',
          title: it.title.trim() || (it.intent === 'add_income' ? 'Income' : 'Expense'),
          amount: Math.round(it.amount * 100) / 100,
          currency: foreign ? it.currency : null,
          fx_rate: rate,
          category: it.category.trim() || (it.intent === 'add_income' ? 'Other income' : 'Other'),
          spent_on: it.date || today(),
          paid_by: it.paid_by === 'company' ? null : me.id,
          paid_to: null,
          shared: false,
          card_id: null,
          note: 'Added by voice',
          receipt_path: null,
          receipt_name: null,
        });
        void showAlert({ title: it.intent === 'add_income' ? 'Income added' : 'Expense added', message: `${it.title.trim()} · ${it.amount} ${it.currency}`, tone: 'access' });
        close();
      } catch (e) {
        setErr((e as Error).message);
        setBusy(false);
      }
    }
  };

  return (
    <>
      <button className="va-fab" onClick={() => (setOpen(true), supported ? listen() : setTyping(true))} title="Voice assistant: add or find cards, costs and income" aria-label="Voice assistant">
        <Mic size={22} />
      </button>
      {open &&
        createPortal(
          <div className="kd-backdrop va-backdrop" onMouseDown={close}>
            <div className="va" role="dialog" aria-label="Voice assistant" onMouseDown={(e) => e.stopPropagation()}>
              <button className="icon-btn va-close" onClick={close} aria-label="Close">
                <X size={18} />
              </button>
              {!it && (
                <>
                  <button className={`va-mic ${listening ? 'on' : ''}`} onClick={listening ? stop : listen} disabled={busy || !supported} aria-label={listening ? 'Stop listening' : 'Start listening'}>
                    {busy ? <Loader2 size={30} className="spin" /> : listening ? <Mic size={30} /> : supported ? <Mic size={30} /> : <MicOff size={30} />}
                  </button>
                  <p className="va-status">
                    {busy ? 'Working it out…' : listening ? 'Listening… speak now' : supported ? 'Tap the mic and say what to add or find' : 'Voice isn’t available here — type instead'}
                  </p>
                  {text && !typing && <p className="va-heard">“{text}”</p>}
                  {(typing || !supported) && (
                    <form
                      className="va-type"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit(text);
                      }}
                    >
                      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Find logo · Expense 39 dollars Shopify" />
                      <button className="btn primary" disabled={busy || !text.trim()} aria-label="Send">
                        <Send size={15} />
                      </button>
                    </form>
                  )}
                  {supported && !typing && (
                    <button className="btn ghost small va-switch" onClick={() => (stop(), setTyping(true))}>
                      <Keyboard size={14} /> Type instead
                    </button>
                  )}
                  <div className="va-examples">
                    <span>“Find logo design” · “Show my tasks”</span>
                    {canAddCards && <span>“Add task fix the checkout page, due Friday, assign Zeeshan”</span>}
                    {money && <span>“Expense 39 dollars for Shopify, software”</span>}
                    {money && <span>“Income 5,000 dirhams from wholesale order”</span>}
                  </div>
                </>
              )}

              {it && (
                <div className="va-confirm">
                  <p className="va-reply">{it.reply}</p>
                  {it.intent === 'search' && (
                    <div className="va-results">
                      {found.length === 0 && <p className="muted">No cards found. Try other words.</p>}
                      {found.map(({ c, list: ln }) => (
                        <button key={c.id} className="va-result" onClick={() => (close(), onOpenCard(c.id))}>
                          <span className="va-result-title">{c.title}</span>
                          <span className="va-result-meta">
                            {ln}
                            {c.due ? ` · due ${c.due}` : ''}
                            {c.completed ? ' · done' : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {it.intent === 'add_card' && canAddCards && (
                    <div className="va-fields">
                      <label>
                        Card
                        <input value={it.title} onChange={(e) => set({ title: e.target.value })} />
                      </label>
                      <label>
                        List
                        <select value={list?.title ?? ''} onChange={(e) => set({ list: e.target.value })}>
                          {lists.map((l) => (
                            <option key={l.id}>{l.title}</option>
                          ))}
                        </select>
                      </label>
                      <label className={needDue ? 'va-missing' : ''}>
                        Due date{needDue ? ' (required)' : ''}
                        <input type="date" value={it.due} onChange={(e) => set({ due: e.target.value })} />
                      </label>
                      <label className={needMember ? 'va-missing' : ''}>
                        Responsible{needMember ? ' (required)' : ''}
                        <select value={personByName(it.member)?.name ?? ''} onChange={(e) => set({ member: e.target.value })}>
                          <option value="">No one yet</option>
                          {people.map((p) => (
                            <option key={p.user_id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      {it.description && (
                        <label className="va-wide">
                          Details
                          <textarea value={it.description} onChange={(e) => set({ description: e.target.value })} rows={2} />
                        </label>
                      )}
                    </div>
                  )}
                  {(it.intent === 'add_expense' || it.intent === 'add_income') && money && (
                    <div className="va-fields">
                      <label className="va-wide">
                        {it.intent === 'add_income' ? 'Income from' : 'Expense for'}
                        <input value={it.title} onChange={(e) => set({ title: e.target.value })} />
                      </label>
                      <label>
                        Amount
                        <span className="va-money">
                          <input inputMode="decimal" value={String(it.amount || '')} onChange={(e) => set({ amount: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
                          <select value={it.currency} onChange={(e) => set({ currency: e.target.value })}>
                            {[...new Set([money.currency, ...CURRENCIES])].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </span>
                      </label>
                      <label>
                        Date
                        <input type="date" value={it.date} onChange={(e) => set({ date: e.target.value })} />
                      </label>
                      <label>
                        Category
                        <input list="va-cats" value={it.category} onChange={(e) => set({ category: e.target.value })} />
                        <datalist id="va-cats">
                          {(it.intent === 'add_income' ? INCOME_CATEGORIES : CATEGORIES).map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        {it.intent === 'add_income' ? 'Received by' : 'Paid by'}
                        <select value={it.paid_by === 'company' ? 'company' : 'me'} onChange={(e) => set({ paid_by: e.target.value as Intent['paid_by'] })}>
                          <option value="me">{me.name} (you)</option>
                          <option value="company">Company account</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="kd-actions">
                    <button className="btn kd-cancel" onClick={() => (reset(), supported && !typing ? listen() : setTyping(true))}>
                      Try again
                    </button>
                    {it.intent !== 'unknown' && it.intent !== 'search' && (
                      <button
                        className="btn primary"
                        disabled={busy || (it.intent === 'add_card' ? !canAddCards || !list || !it.title.trim() || needDue || needMember : !(it.amount > 0))}
                        onClick={confirm}
                      >
                        {busy ? 'Saving…' : it.intent === 'add_card' ? 'Add card' : it.intent === 'add_income' ? 'Add income' : 'Add expense'}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {err && <div className="auth-error va-err">{err}</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
