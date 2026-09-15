/**
 * /terms — Terms of Use, Acceptable Use & Privacy Notice.
 *
 * Static page, no data dependencies. The entry gate (components/terms-gate.tsx)
 * summarises this and links here; keep the two in step when either changes.
 *
 * NOT LEGAL ADVICE: this is a carefully written starting point for a site that
 * publishes police aircraft positions. It has not been reviewed by a lawyer.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use · VP-Overwatch',
  description: 'Terms of use, acceptable use and privacy notice for the VP-Overwatch community aircraft-awareness map.',
}

/** Single place to change the public contact address. */
const CONTACT_EMAIL = 'contact@vpoverwatch.com'
const EFFECTIVE_DATE = '15 September 2026'

const H2: React.CSSProperties = {
  fontFamily: "'Space Mono', monospace",
  fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: '#e8f0ff', margin: '26px 0 10px',
}
const P: React.CSSProperties = { fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.72)', margin: '0 0 12px' }
const UL: React.CSSProperties = { ...P, paddingLeft: 20, margin: '0 0 14px' }
const LI: React.CSSProperties = { marginBottom: 6 }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={H2}>{title}</h2>
      {children}
    </section>
  )
}

export default function TermsPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#0b0e13', padding: '40px 20px 80px' }}>
      <article style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="/" style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: '0.1em', color: '#3b82f6', textDecoration: 'none' }}>
          ← BACK TO THE MAP
        </a>

        <h1 style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, color: '#e8f0ff', margin: '22px 0 6px', lineHeight: 1.3 }}>
          Terms of Use, Acceptable Use &amp; Privacy Notice
        </h1>
        <p style={{ ...P, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
          Effective {EFFECTIVE_DATE} · applies to everything served at this domain
        </p>

        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderLeft: '3px solid #3b82f6', borderRadius: 6, padding: '14px 18px', background: 'rgba(59,130,246,0.06)', margin: '18px 0 6px' }}>
          <p style={{ ...P, margin: 0, color: 'rgba(255,255,255,0.85)' }}>
            <strong>In short:</strong> this is an independent community site that republishes publicly broadcast
            aircraft and traffic data, so the Victorian community can see where police are operating — in the air
            and on the ground — and stay well clear of it. It is <strong>not affiliated with Victoria Police or any
            government agency</strong>, its data <strong>can be wrong or delayed</strong>, and it
            <strong>must not be used for any unlawful purpose</strong> — including harassing anyone, or obstructing or
            evading police operations.
          </p>
        </div>

        <Section title="1. What this site is — and is not">
          <p style={P}>
            VP-Overwatch is an independent, non-commercial community project. It displays information that is already
            publicly available — aircraft positions broadcast on the open ADS-B network, and publicly reported road,
            traffic and ground activity — so that the wider Victorian community can see where police are operating,
            whether from the air or on the ground.
          </p>
          <p style={P}>
            Its purpose is <strong>public awareness and public safety</strong>. Knowing that an operation is underway
            nearby helps people stay clear of it, avoid finding themselves in the middle of it, and avoid interfering
            with it. It is not an operational, investigative, or enforcement tool, and it must not be used as one.
          </p>
        </Section>

        <Section title="2. No affiliation or endorsement">
          <p style={P}>This site is not affiliated with, endorsed by, sponsored by, or connected to:</p>
          <ul style={UL}>
            <li style={LI}>Victoria Police, including the Victoria Police Air Wing</li>
            <li style={LI}>the State of Victoria, or any government department or agency</li>
            <li style={LI}>any emergency service organisation</li>
            <li style={LI}>any aircraft operator, owner, or manufacturer</li>
          </ul>
          <p style={P}>
            Registrations and call signs shown are public identifiers broadcast by the aircraft themselves. Nothing here
            is official information, and no agency has reviewed, approved, or provided it.
          </p>
        </Section>

        <Section title="3. Where the data comes from, and how wrong it can be">
          <p style={P}>
            Sources include publicly broadcast ADS-B and Mode-S data (including via adsb.lol and the OpenSky Network),
            publicly reported traffic alert data (via WazeAPI.com), and map data from OpenStreetMap contributors and
            Protomaps.
          </p>
          <ul style={UL}>
            <li style={LI}>Positions can lag by seconds to minutes, or be missing entirely.</li>
            <li style={LI}>Some positions are derived by multilateration (MLAT) and may be out by hundreds of metres, with unreliable altitude.</li>
            <li style={LI}>Aircraft can be misidentified; call signs and types are best-effort.</li>
            <li style={LI}>Coverage depends on third-party ground receivers and is never guaranteed.</li>
          </ul>
          <p style={P}>
            Do not use this site for navigation, flight planning, safety-critical decisions, or as evidence of anything.
            It is an approximate picture of publicly broadcast data — nothing more.
          </p>
        </Section>

        <Section title="4. Acceptable use">
          <p style={P}>You must not use this site, or information obtained from it:</p>
          <ul style={UL}>
            <li style={LI}>for any unlawful purpose, or to plan, assist, or conceal an offence under Victorian or Commonwealth law</li>
            <li style={LI}>to harass, stalk, intimidate, threaten, or locate any person</li>
            <li style={LI}>to interfere with, obstruct, delay, or evade police or emergency services operations</li>
            <li style={LI}>to identify or target individuals — crew, passengers, or members of the public</li>
            <li style={LI}>to scrape, bulk-download, resell, or redistribute the service or its data without permission</li>
            <li style={LI}>to probe, overload, or attempt to bypass the security, authentication, or rate limits of this site</li>
          </ul>
          <p style={P}>
            The purpose of this site is to help people <strong>stay clear of</strong> police operations — which is the
            opposite of helping anyone avoid, obstruct, or evade them. Using it that way breaches these terms and may
            itself be an offence.
          </p>
          <p style={P}>
            Access is rate-limited and may be limited, suspended, or blocked at any time and without notice, at the
            operator&apos;s discretion.
          </p>
        </Section>

        <Section title="5. Journalists, researchers and professional users">
          <p style={P}>
            You may reference this site and link to it. You must not present its output as official, verified, or
            complete, or imply endorsement by any agency. Corrections and right-of-reply requests are welcome via the
            contact address below.
          </p>
        </Section>

        <Section title="6. Community submissions">
          <p style={P}>
            If you submit a report, sighting, or correction, you confirm it is accurate to your knowledge, that you have
            the right to share it, and that it contains no one else&apos;s personal information and nothing unlawful. You
            grant the project a non-exclusive, royalty-free licence to display and adapt it. Submissions may be declined
            or removed at any time. Community reports are only published after independent corroboration by multiple
            separate reports; unconfirmed submissions are not shown publicly.
          </p>
        </Section>

        <Section title="7. Privacy">
          <ul style={UL}>
            <li style={LI}><strong>Viewing needs no account</strong> and no personal details.</li>
            <li style={LI}>
              <strong>Location.</strong> Your browser is asked for your position only if you allow it. For anonymous
              visitors, that position is coarsened to a grid of roughly 110 metres before it is stored, and is used only
              to centre the area of the map queried for aircraft data. It is never published and never shown to other users.
            </li>
            <li style={LI}>
              <strong>Alert subscribers (optional).</strong> If you switch alerts on, you may store a precise location and
              a radius so the site can tell when an aircraft is near you. If you provide a phone number for text or phone
              alerts, it is encrypted before storage and used only to deliver the alerts you asked for.
            </li>
            <li style={LI}>Aircraft and traffic data shown here is not about you and is not derived from your device.</li>
            <li style={LI}>Personal information is not sold, and the site carries no third-party advertising or tracking pixels.</li>
            <li style={LI}>
              Personal information is handled consistently with the <em>Privacy Act 1988</em> (Cth) and, where it applies,
              the <em>Privacy and Data Protection Act 2014</em> (Vic). You can stop collection at any time by turning alerts
              off or declining location access — stored locations expire automatically.
            </li>
          </ul>
        </Section>

        <Section title="8. Intellectual property">
          <p style={P}>
            The site&apos;s own code, design, and text belong to the project. Third-party data and map tiles remain the
            property of their providers and are attributed on the site. All trade marks belong to their owners, and their
            appearance here implies no endorsement or affiliation.
          </p>
        </Section>

        <Section title="9. Liability">
          <p style={P}>
            This site is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, express or
            implied. To the maximum extent permitted by law, the operator is not liable for any loss, damage, cost, or
            injury arising from use of, or reliance on, this site or its data — including any decision made on the basis
            of incomplete or incorrect information.
          </p>
          <p style={P}>
            Nothing in these terms excludes, restricts, or modifies any consumer guarantee, right, or remedy you may have
            under the <em>Australian Consumer Law</em> or any other law that cannot lawfully be excluded.
          </p>
        </Section>

        <Section title="10. Changes to these terms">
          <p style={P}>
            These terms may change. The effective date above will be updated, and continued use after a change means you
            accept the revised terms. The entry notice is shown again whenever the terms change.
          </p>
        </Section>

        <Section title="11. Governing law">
          <p style={P}>
            These terms are governed by the laws of Victoria, Australia, and you submit to the exclusive jurisdiction of
            the courts of that state.
          </p>
        </Section>

        <Section title="12. Contact">
          <p style={P}>
            Corrections, takedown requests, abuse reports, and press enquiries:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#3b82f6' }}>{CONTACT_EMAIL}</a>
          </p>
          <p style={P}>
            If you believe information on this site about you or your organisation is inaccurate, tell us and we will
            correct or remove it.
          </p>
        </Section>

        <p style={{ ...P, marginTop: 30, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          By continuing to use this site you confirm that you have read and understood these terms.
        </p>
      </article>
    </main>
  )
}
