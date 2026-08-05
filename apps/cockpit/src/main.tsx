import { StrictMode, useCallback, useEffect, useRef, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { cockpitMessages, consumeLaunchFragment, localizedGatePurpose, localizedSemanticActivity, semanticActivity, snapshotRecovery, type CockpitLanguage, type SemanticActivity } from './protocol.ts'
import './styles.css'

type RunState = 'idle' | 'waiting' | 'running' | 'retrying' | 'successful' | 'recovery-required' | 'stopped' | 'rate-limit' | 'interrupted' | 'needs-user'
type FailureCode = 'receipt' | 'denial' | 'hook' | 'stall' | 'framing' | 'io' | 'rate_limit_five_hour' | 'rate_limit_seven_day' | 'interrupted' | 'recovery' | 'unknown_event'
type Gate = { name: string; status: string; authority: string; verified: boolean }
type Snapshot = { schemaVersion: number; projectId: string; revision: number; stage: string; runState: RunState; language: CockpitLanguage; blueprintRevision: number; gates: Gate[]; pendingDecision: string | null; failureCode?: FailureCode }
type Command = 'submitIdea' | 'approveBlueprint' | 'approvePlan' | 'startBuild' | 'acceptResult' | 'requestChange' | 'rollback'
type ViewState = { language: CockpitLanguage; snapshot: Snapshot | null; activity: SemanticActivity | null; idea: string; loading: boolean; unavailable: boolean; setLanguage(language: CockpitLanguage): void; setSnapshot(snapshot: Snapshot): void; setActivity(activity: SemanticActivity | null): void; setIdea(idea: string): void; setLoading(loading: boolean): void; setUnavailable(unavailable: boolean): void }
const useView = create<ViewState>((set) => ({ language: 'tr', snapshot: null, activity: null, idea: '', loading: true, unavailable: false, setLanguage: (language) => set({ language }), setSnapshot: (snapshot) => set({ snapshot, language: snapshot.language === 'en' ? 'en' : 'tr', loading: false, unavailable: false }), setActivity: (activity) => set({ activity }), setIdea: (idea) => set({ idea }), setLoading: (loading) => set({ loading }), setUnavailable: (unavailable) => set({ unavailable, loading: false }) }))

const actionFor = (pending: string | null): Command | null => pending === 'submitIdea' || pending === 'approveBlueprint' || pending === 'approvePlan' || pending === 'startBuild' || pending === 'acceptResult' ? pending : null
const stateKeys: Record<string, keyof typeof cockpitMessages.tr> = { 'needs-user': 'needsUser', 'rate-limit': 'rateLimit', 'recovery-required': 'recoveryRequired', interrupted: 'interrupted', running: 'running', waiting: 'waiting', retrying: 'retrying', stopped: 'stopped', successful: 'successful', idle: 'idle' }
const gateStatusKeys: Record<string, keyof typeof cockpitMessages.tr> = { pending: 'gatePending', running: 'gateRunning', failed: 'gateFailed', blocked: 'gateBlocked', needs_user: 'gateNeedsUser', passed: 'gatePassed' }
const stateKey = (state: string): keyof typeof cockpitMessages.tr => stateKeys[state] ?? 'waiting'
const rateLimitStateKey = (failureCode: FailureCode | undefined): keyof typeof cockpitMessages.tr => failureCode === 'rate_limit_five_hour' ? 'rateLimitFiveHour' : failureCode === 'rate_limit_seven_day' ? 'rateLimitSevenDay' : 'rateLimit'
const gateStatusKey = (status: string): keyof typeof cockpitMessages.tr => gateStatusKeys[status] ?? 'gatePending'
const stageIndex = (stage: string): number => { const match = /^G([0-6])$/.exec(stage); return match ? Number(match[1]) : 0 }
const hasVerifiedMachineEvidence = (gates: Gate[]): boolean => gates.length > 0
  && gates.some((gate) => gate.authority === 'machine')
  && gates.every((gate) => gate.status === 'passed')
  && gates.every((gate) => gate.authority !== 'machine' || gate.verified === true)
const sameCanonicalSnapshot = (left: Snapshot | null, right: Snapshot): boolean => left !== null
  && left.schemaVersion === right.schemaVersion
  && left.projectId === right.projectId
  && left.revision === right.revision
  && left.blueprintRevision === right.blueprintRevision
  && left.stage === right.stage
  && left.runState === right.runState
  && left.language === right.language
  && left.pendingDecision === right.pendingDecision
  && left.failureCode === right.failureCode
  && JSON.stringify(left.gates) === JSON.stringify(right.gates)
type SemanticPhaseMeaning = Pick<Snapshot, 'stage' | 'runState' | 'pendingDecision'>
const semanticPhaseMeanings: Record<string, SemanticPhaseMeaning | null> = {
  'Durum güncellendi.': null,
  'Taslak hazır; onayınızı bekliyor.': { stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' },
  'Plan hazır; onayınızı bekliyor.': { stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' },
  'Plan hazır; devam etmek için onayınızı bekliyorum.': { stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' },
  'İnşa başlatılmaya hazır.': { stage: 'G3', runState: 'waiting', pendingDecision: 'startBuild' },
  'İnşa güvenle ilerliyor.': { stage: 'G4', runState: 'running', pendingDecision: null },
  'Kontroller tamamlandı; sonucu inceleyin.': { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
  'Sonuç kabul edildi.': { stage: 'G6', runState: 'successful', pendingDecision: null },
  'Taslak değişikliği bekleniyor.': { stage: 'G1', runState: 'needs-user', pendingDecision: 'submitIdea' },
  'Değişiklik planı bekleniyor.': { stage: 'G2', runState: 'needs-user', pendingDecision: 'approvePlan' },
  'Önceki güvenli sonuca dönüldü.': { stage: 'G5', runState: 'stopped', pendingDecision: 'acceptResult' },
}

const semanticActivityMatchesSnapshot = (activity: SemanticActivity | null, snapshot: Snapshot): boolean => {
  if (activity === null || activity.revision !== snapshot.revision) return false
  const meaning = semanticPhaseMeanings[activity.message]
  return meaning !== undefined
    && meaning !== null
    && meaning.stage === snapshot.stage
    && meaning.runState === snapshot.runState
    && meaning.pendingDecision === snapshot.pendingDecision
}

const semanticActivityFromSnapshot = (snapshot: Snapshot): SemanticActivity | null => {
  for (const [message, meaning] of Object.entries(semanticPhaseMeanings)) {
    if (meaning !== null
      && meaning.stage === snapshot.stage
      && meaning.runState === snapshot.runState
      && meaning.pendingDecision === snapshot.pendingDecision) {
      return { type: 'phase_update', revision: snapshot.revision, message }
    }
  }
  return null
}

async function exchangeLaunch(): Promise<void> {
  const launch = consumeLaunchFragment(window.location.href)
  const response = await fetch('/api/v1/session', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ launchToken: launch.token }) })
  if (!response.ok && response.status !== 401) throw new Error('session unavailable')
  history.replaceState(null, '', launch.cleanUrl)
}

function App(): JSX.Element {
  const { language, snapshot, activity, idea, loading, unavailable, setLanguage, setSnapshot, setActivity, setIdea, setLoading, setUnavailable } = useView()
  const heading = useRef<HTMLHeadingElement>(null)
  const lastRevision = useRef<number | undefined>(undefined)
  const requiredRevision = useRef<number | undefined>(undefined)
  const socket = useRef<WebSocket | null>(null)
  const messages = cockpitMessages[language]
  const revision = snapshot?.revision
  const projectId = snapshot?.projectId

  const recover = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/projects/current', { credentials: 'include', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
      if (!response.ok) throw new Error('snapshot unavailable')
      const value = await response.json() as Snapshot
      if (!Number.isSafeInteger(value.revision) || typeof value.stage !== 'string' || typeof value.runState !== 'string') throw new Error('snapshot unavailable')
      const nextSnapshot: Snapshot = { ...value, language: value.language === 'en' ? 'en' : 'tr', gates: Array.isArray(value.gates) ? value.gates : [], pendingDecision: typeof value.pendingDecision === 'string' ? value.pendingDecision : null }
      if (requiredRevision.current !== undefined && value.revision < requiredRevision.current) return setUnavailable(true)
      if (requiredRevision.current !== undefined && value.revision >= requiredRevision.current) requiredRevision.current = undefined
      if (lastRevision.current !== undefined && value.revision < lastRevision.current) return setUnavailable(false)
      lastRevision.current = value.revision
      if (sameCanonicalSnapshot(useView.getState().snapshot, nextSnapshot)) return setUnavailable(false)
      const current = useView.getState()
      setActivity(semanticActivityMatchesSnapshot(current.activity, nextSnapshot) ? current.activity : semanticActivityFromSnapshot(nextSnapshot))
      requiredRevision.current = undefined
      setSnapshot(nextSnapshot)
    } catch { setUnavailable(true) }
  }, [setActivity, setLoading, setSnapshot, setUnavailable])

  useEffect(() => { void (async () => { try { if (window.location.hash) await exchangeLaunch(); await recover() } catch { setUnavailable(true) } })() }, [recover, setUnavailable])
  useEffect(() => { if (revision !== undefined) heading.current?.focus() }, [revision])
  useEffect(() => {
    if (!projectId) return
    const connect = (): void => {
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const afterRevision = lastRevision.current
      const suffix = Number.isSafeInteger(afterRevision) ? `?afterRevision=${afterRevision}` : ''
      const ws = new WebSocket(`${scheme}//${location.host}/api/v1/events${suffix}`)
      socket.current = ws
      ws.onmessage = (message) => {
        try {
          const raw = JSON.parse(typeof message.data === 'string' ? message.data : 'null') as { type?: unknown }
          if (raw?.type === 'snapshot_required') { void recover(); return }
          const event = semanticActivity(raw)
          const last = lastRevision.current
          if (last !== undefined && event.revision < last) return
          if (last !== undefined && event.revision === last) {
            const currentSnapshot = useView.getState().snapshot
            if (currentSnapshot !== null && semanticActivityMatchesSnapshot(event, currentSnapshot)) setActivity(event)
            return
          }
          requiredRevision.current = Math.max(requiredRevision.current ?? -1, event.revision)
          setUnavailable(true)
          if (snapshotRecovery({ lastRevision: last, eventRevision: event.revision }).kind === 'snapshot') void recover()
          else { setActivity(event); void recover() }
        } catch { void recover() }
      }
      ws.onclose = () => { window.setTimeout(() => { if (socket.current === ws) { void recover().finally(connect) } }, 350) }
    }
    connect()
    return () => { socket.current?.close(); socket.current = null }
  }, [projectId, recover, setActivity, setUnavailable])

  const send = async (type: Command): Promise<void> => {
    try {
      const body = type === 'submitIdea' ? { type, idea: idea.trim() || messages.ideaFallback } : { type }
      const response = await fetch('/api/v1/projects/current/commands', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('command unavailable')
      await recover()
    } catch { setUnavailable(true) }
  }

  const recoveryRequired = snapshot?.runState === 'recovery-required'
  const waitOnly = snapshot?.runState === 'running' || snapshot?.runState === 'retrying' || snapshot?.runState === 'rate-limit'
  const currentAction = snapshot && !loading && !unavailable && !recoveryRequired && !waitOnly ? actionFor(snapshot.pendingDecision) : null
  const actionLabel = currentAction === 'submitIdea' ? messages.submitIdeaLabel : currentAction ? messages[currentAction] : null
  const current = snapshot ? stageIndex(snapshot.stage) : 0
  const accepted = snapshot?.stage === 'G6' && snapshot.runState === 'successful'
  const status = accepted ? messages.successful : snapshot ? messages[snapshot.runState === 'rate-limit' ? rateLimitStateKey(snapshot.failureCode) : stateKey(snapshot.runState)] : messages.loading
  const evidenceSummary = recoveryRequired ? messages.historicalEvidence : snapshot && hasVerifiedMachineEvidence(snapshot.gates) ? messages.verified : messages.unverified

  return <div className="cockpit">
    <aside className="rail" aria-label={messages.lane}>
      <div className="brand">Guidelane</div>
      <ol>{messages.stageNames.map((name, index) => <li key={name} className={index === current ? 'active' : index < current ? 'complete' : ''}><span aria-hidden="true">G{index}</span><span>{name}</span><small>{index === current ? messages.active : index < current ? messages.completed : messages.upcoming}</small></li>)}</ol>
    </aside>
    <main>
      <header className="masthead"><p>{messages.current} · {snapshot?.stage ?? 'G0'}</p><span data-testid="run-state">{status}</span></header>
      <section className="now" aria-labelledby="now-heading">
        <h1 id="now-heading" ref={heading} tabIndex={-1}>{accepted ? messages.readyHeading : messages.appTitle}</h1>
        <p className="status-copy" role="status">{accepted ? status : activity ? localizedSemanticActivity(activity.message, language) : status}</p>
        {unavailable && <p className="warning" role="alert">{messages.unavailable}</p>}
        {currentAction && <><p className="prompt">{currentAction === 'submitIdea' ? messages.submitIdeaHint : status}</p>{currentAction === 'submitIdea' && <div className="idea-field"><label htmlFor="idea">{messages.ideaLabel}</label><textarea id="idea" value={idea} placeholder={messages.ideaPlaceholder} onChange={(event) => setIdea(event.target.value)} /></div>}<button className="primary" type="button" tabIndex={0} onClick={() => void send(currentAction)}>{actionLabel}</button></>}
        {!currentAction && (unavailable || recoveryRequired) && <button className="primary" type="button" tabIndex={0} onClick={() => void recover()}>{messages.recovery}</button>}
        {!currentAction && accepted && <p className="accepted">{messages.acceptanceConfirmation}</p>}
      </section>
      <section className="evidence" aria-labelledby="evidence-heading"><div><p>{messages.evidence}</p><h2 id="evidence-heading">{evidenceSummary}</h2></div><dl>{snapshot?.gates.map((gate, index) => <div key={`${gate.name}-${index}`}><dt>{localizedGatePurpose(gate.name, language)}</dt><dd>{messages[gateStatusKey(gate.status)]}</dd></div>)}</dl></section>
    </main>
    <button className="language" type="button" tabIndex={0} onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}>{messages.currentLanguage} / {messages.languageSwitch}</button>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
