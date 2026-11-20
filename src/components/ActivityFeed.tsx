import { Fragment, useMemo, useState } from 'react';
import { isImage, pathsOf, useSignedUrls } from '../lib/files';
import type { Activity, Attachment, BoardData, Person } from '../lib/types';
import { Avatar, timeAgo } from './ui';

interface Entry {
  a: Activity;
  repeat: number; // how many identical actions in a row were folded into this one
}

/** Turns “quoted” card titles in an activity line into links to the card. */
function Linked({ text, cardId, data, onOpenCard }: { text: string; cardId?: string; data: BoardData; onOpenCard: (id: string) => void }) {
  const parts = text.split(/(“[^”]*”)/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^“(.*)”$/);
        if (m && cardId && data.cards[cardId] && (m[1] === data.cards[cardId].title || i === 1)) {
          return (
            <button key={i} className="act-link" onClick={() => onOpenCard(cardId)}>
              {m[1]}
            </button>
          );
        }
        return <Fragment key={i}>{part.replace(/[“”]/g, '')}</Fragment>;
      })}
    </>
  );
}

/**
 * Trello-style activity feed: avatar, "Name did X to <card>", time link, image previews
 * for attachments. Consecutive identical board-level actions are folded ("×6").
 */
export function ActivityFeed({
  data,
  people,
  by,
  onOpenCard,
}: {
  data: BoardData;
  people: Person[];
  by?: string | null; // only this person's activity
  onOpenCard: (id: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const peopleByName = useMemo(() => new Map(people.map((p) => [p.name, p])), [people]);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const a of data.activity) {
      if (by && a.by !== by) continue;
      const last = out[out.length - 1];
      if (last && !a.cardId && !last.a.cardId && last.a.by === a.by && last.a.text === a.text) last.repeat++;
      else out.push({ a, repeat: 1 });
    }
    return out;
  }, [data.activity, by]);

  // Attachments mentioned in the feed (for image previews).
  const attachments = useMemo(() => {
    const m = new Map<string, Attachment>();
    for (const { a } of entries) {
      if (!a.attachmentId || !a.cardId) continue;
      const att = data.cards[a.cardId]?.attachments.find((x) => x.id === a.attachmentId);
      if (att) m.set(a.attachmentId, att);
    }
    return m;
  }, [entries, data.cards]);
  const urls = useSignedUrls(pathsOf([...attachments.values()].filter((x) => isImage(x))));

  if (entries.length === 0) {
    return <p className="muted act-empty">{by ? `${by} hasn’t done anything on this board yet.` : 'No activity yet.'}</p>;
  }

  return (
    <>
      <ul className="act-feed">
        {entries.map(({ a, repeat }) => {
          const person = peopleByName.get(a.by);
          const card = a.cardId ? data.cards[a.cardId] : undefined;
          const att = a.attachmentId ? attachments.get(a.attachmentId) : undefined;
          const img = att?.path && isImage(att) ? urls.get(att.path) : undefined;
          return (
            <li key={a.id} className="act-item">
              <Avatar id={person?.user_id ?? a.by} name={a.by} src={person?.avatar_url} size={36} />
              <div className="act-main">
                <div className="act-line">
                  <strong>{a.by}</strong>{' '}
                  {att && card ? (
                    <>
                      attached{' '}
                      <button className="act-link plain" onClick={() => onOpenCard(card.id)}>
                        {att.name || att.url}
                      </button>{' '}
                      to{' '}
                      <button className="act-link" onClick={() => onOpenCard(card.id)}>
                        {card.title}
                      </button>
                    </>
                  ) : (
                    <Linked text={a.text} cardId={card ? a.cardId : undefined} data={data} onOpenCard={onOpenCard} />
                  )}
                  {repeat > 1 && <span className="act-repeat">×{repeat}</span>}
                </div>
                {card ? (
                  <button className="act-time" onClick={() => onOpenCard(card.id)} title={new Date(a.at).toLocaleString()}>
                    {timeAgo(a.at)}
                  </button>
                ) : (
                  <span className="act-time static" title={new Date(a.at).toLocaleString()}>
                    {timeAgo(a.at)}
                  </span>
                )}
                {img && (
                  <button className="act-preview" onClick={() => setPreview(img)} title="Preview">
                    <img src={img} alt={att?.name ?? ''} loading="lazy" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)}>
          <img src={preview} alt="" />
        </div>
      )}
    </>
  );
}
