import { useState } from 'react'
import type { ReactNode } from 'react'

export function Lobby({ gameId, leave }: { gameId: string; leave: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}${location.pathname}?game=${gameId}`

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'In or Out', text: 'Can you dodge my predictions?', url: link })
      } else {
        await navigator.clipboard.writeText(link)
        setCopied(true)
      }
    } catch {
      // Share sheet dismissed or clipboard blocked. The link is on screen to copy by hand.
    }
  }

  return (
    <section className="screen h2h">
      <h2 className="prompt">Send this link to a friend</h2>
      <input
        className="answer-input share-link"
        readOnly
        value={link}
        aria-label="Share link"
        onFocus={(e) => e.target.select()}
      />
      <button className="btn btn-primary" onClick={share} autoFocus>
        {copied ? 'Copied' : 'Share link'}
      </button>
      <p className="pitch" role="status">
        The game starts when they join.
      </p>
      {leave}
    </section>
  )
}
