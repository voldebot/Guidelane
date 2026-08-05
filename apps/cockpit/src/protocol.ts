export type CockpitLanguage = 'tr' | 'en'

export const cockpitMessages = {
  tr: {
    appTitle: 'Guidelane Güvenli İlerleme', readyHeading: 'İşiniz hazır.', acceptanceConfirmation: 'Sonuç kabul edildi.', languageSwitch: 'English', currentLanguage: 'Türkçe', submitIdea: 'Fikr', submitIdeaLabel: 'Fikir paylaş', ideaLabel: 'Fikriniz', ideaPlaceholder: 'Örneğin: Yerel web projem için bir başlangıç oluştur.', ideaFallback: 'Yerel web projesi için bir başlangıç oluştur.', approveBlueprint: 'Taslak onayla', approvePlan: 'Planı onayla', startBuild: 'inşa başlat', acceptResult: 'Sonuç kabul et', activity: 'Etkinlik', waiting: 'Sıradaki güvenli adım için bekleniyor.', running: 'İlerliyor; kontroller sürüyor.', retrying: 'Tekrar deneniyor; lütfen bekleyin.', stopped: 'Durdu; sonraki adımı seçebilirsiniz.', interrupted: 'İşlem kesildi; güvenli şekilde yeniden deneyebilirsiniz.', needsUser: 'Sizin kararınıza ihtiyaç var.', rateLimit: 'Kısa bir bekleme gerekli.', rateLimitFiveHour: 'Beş saatlik kullanım sınırının yenilenmesi bekleniyor.', rateLimitSevenDay: 'Yedi günlük kullanım sınırının yenilenmesi bekleniyor.', recoveryRequired: 'Kurtarma gerekli; güncel durum yeniden alınıyor.', historicalEvidence: 'Önceden doğrulanmış makine kanıtı', successful: 'Tamamlandı.', idle: 'Başlamaya hazırsınız.', lane: 'İlerleme yolu', evidence: 'Kanıt özeti', verified: 'Makine kontrolü doğrulandı.', unverified: 'Makine kontrolü doğrulanmayı bekliyor.', current: 'Şimdi', changeLanguage: 'Türkçe', requestChange: 'Değişiklik iste', rollback: 'Önceki sonuca dön', submitIdeaHint: 'Başlamak için fikrinizi paylaşın.', loading: 'Güvenli durum yükleniyor.', unavailable: 'Güncel duruma şu anda erişilemiyor.', completed: 'Bu aşama tamamlandı.', upcoming: 'Bu aşama sırada.', active: 'Bu aşamadasınız.', recovery: 'Durumu yenile', status: 'Durum', gatePending: 'Kontrol bekliyor.', gateRunning: 'Kontrol sürüyor.', gateFailed: 'Kontrol başarısız oldu.', gateBlocked: 'Kontrol engellendi.', gateNeedsUser: 'Sizin işleminiz gerekiyor.', gatePassed: 'Kontrol geçti.', blueprintReady: 'Taslak hazır; onayınızı bekliyor.', planReady: 'Plan hazır; onayınızı bekliyor.', planReadyToContinue: 'Plan hazır; devam etmek için onayınızı bekliyorum.', blueprintChangePending: 'Taslak değişikliği bekleniyor.', buildReady: 'İnşa başlatılmaya hazır.', buildProgressing: 'İnşa güvenle ilerliyor.', checksComplete: 'Kontroller tamamlandı; sonucu inceleyin.', changePlanPending: 'Değişiklik planı bekleniyor.', rollbackComplete: 'Önceki güvenli sonuca dönüldü.', gateLintPurpose: 'Yazım ve düzen kontrolü', gateTypePurpose: 'Tür uyumluluğu kontrolü', gateUnitPurpose: 'Davranış ve işlev kontrolü', gateBuildPurpose: 'Kurulum oluşturma kontrolü', gateBootPurpose: 'Açılış kontrolü', gateAxePurpose: 'Erişilebilirlik kontrolü', gateSmokePurpose: 'Temel kullanım denetimi', gateGenericPurpose: 'Makine kontrolü', stageNames: ['Başlangıç', 'Taslak', 'Plan', 'Hazırlık', 'İnşa', 'İnceleme', 'Kabul']
  },
  en: {
    appTitle: 'Guidelane Safe Progress', readyHeading: 'Your work is ready.', acceptanceConfirmation: 'Result accepted.', languageSwitch: 'Türkçe', currentLanguage: 'English', submitIdea: 'Share idea', submitIdeaLabel: 'Share idea', ideaLabel: 'Your idea', ideaPlaceholder: 'For example: Create a starting point for my local web project.', ideaFallback: 'Create a starting point for a local web project.', approveBlueprint: 'Approve blueprint', approvePlan: 'Approve plan', startBuild: 'Start build', acceptResult: 'Accept result', activity: 'Activity', waiting: 'Waiting for the next safe step.', running: 'Progressing; checks are underway.', retrying: 'Trying again; please wait.', stopped: 'Stopped; you can choose the next step.', interrupted: 'Work was interrupted; you can safely try again.', needsUser: 'Your decision is needed.', rateLimit: 'A short wait is needed.', rateLimitFiveHour: 'Waiting for the five-hour usage limit to reset.', rateLimitSevenDay: 'Waiting for the seven-day usage limit to reset.', recoveryRequired: 'Recovery is needed; getting the current state again.', historicalEvidence: 'Previously verified machine evidence', successful: 'Completed.', idle: 'You are ready to begin.', lane: 'Progress lane', evidence: 'Evidence summary', verified: 'Machine check verified.', unverified: 'Machine check is awaiting verification.', current: 'Now', changeLanguage: 'English', requestChange: 'Request change', rollback: 'Return to earlier result', submitIdeaHint: 'Share your idea to begin.', loading: 'Loading safe state.', unavailable: 'The current state is unavailable right now.', completed: 'This stage is complete.', upcoming: 'This stage is next.', active: 'You are here.', recovery: 'Refresh status', status: 'Status', gatePending: 'Gate is pending.', gateRunning: 'Gate is running.', gateFailed: 'Gate failed.', gateBlocked: 'Gate is blocked.', gateNeedsUser: 'Gate needs user action.', gatePassed: 'Gate passed.', blueprintReady: 'Blueprint is ready; awaiting your approval.', planReady: 'Plan is ready; awaiting your approval.', planReadyToContinue: 'Plan is ready; awaiting your approval to continue.', blueprintChangePending: 'Blueprint change is pending.', buildReady: 'Build is ready to start.', buildProgressing: 'Build is progressing safely.', checksComplete: 'Checks are complete; review the result.', changePlanPending: 'Change plan is pending.', rollbackComplete: 'Returned to the previous safe result.', gateLintPurpose: 'Style and format check', gateTypePurpose: 'Compatibility check', gateUnitPurpose: 'Behaviour check', gateBuildPurpose: 'Assembly check', gateBootPurpose: 'Start-up check', gateAxePurpose: 'Accessibility check', gateSmokePurpose: 'Basic use check', gateGenericPurpose: 'Machine check', stageNames: ['Start', 'Blueprint', 'Plan', 'Ready', 'Build', 'Review', 'Accepted']
  },
} as const

export type SemanticActivity = { type: 'phase_update'; revision: number; message: string }
type CockpitMessageKey = Exclude<keyof typeof cockpitMessages.tr, 'stageNames'>
const PRODUCT_SEMANTIC_MESSAGES = new Set([
  'Durum güncellendi.',
  'Taslak hazır; onayınızı bekliyor.',
  'Plan hazır; onayınızı bekliyor.',
  'Plan hazır; devam etmek için onayınızı bekliyorum.',
  'Taslak değişikliği bekleniyor.',
  'İnşa başlatılmaya hazır.',
  'İnşa güvenle ilerliyor.',
  'Kontroller tamamlandı; sonucu inceleyin.',
  'Sonuç kabul edildi.',
  'Değişiklik planı bekleniyor.',
  'Önceki güvenli sonuca dönüldü.',
])

export function semanticActivity(value: unknown): SemanticActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unsafe semantic event')
  const event = value as Record<string, unknown>
  if (event.type !== 'phase_update' || !Number.isSafeInteger(event.revision) || (event.revision as number) < 0 || typeof event.message !== 'string' || !PRODUCT_SEMANTIC_MESSAGES.has(event.message)) throw new Error('unsafe semantic event')
  return { type: 'phase_update', revision: event.revision as number, message: event.message }
}

const semanticActivityKeys: Record<string, CockpitMessageKey> = {
  'Durum güncellendi.': 'waiting',
  'Taslak hazır; onayınızı bekliyor.': 'blueprintReady',
  'Plan hazır; onayınızı bekliyor.': 'planReady',
  'Plan hazır; devam etmek için onayınızı bekliyorum.': 'planReadyToContinue',
  'Taslak değişikliği bekleniyor.': 'blueprintChangePending',
  'İnşa başlatılmaya hazır.': 'buildReady',
  'İnşa güvenle ilerliyor.': 'buildProgressing',
  'Kontroller tamamlandı; sonucu inceleyin.': 'checksComplete',
  'Sonuç kabul edildi.': 'acceptanceConfirmation',
  'Değişiklik planı bekleniyor.': 'changePlanPending',
  'Önceki güvenli sonuca dönüldü.': 'rollbackComplete',
}

export function localizedSemanticActivity(message: string, language: CockpitLanguage): string {
  const key = semanticActivityKeys[message]
  return key ? cockpitMessages[language][key] : cockpitMessages[language].waiting
}

const gatePurposeKeys: Record<string, CockpitMessageKey> = {
  lint: 'gateLintPurpose',
  type: 'gateTypePurpose',
  unit: 'gateUnitPurpose',
  build: 'gateBuildPurpose',
  boot: 'gateBootPurpose',
  axe: 'gateAxePurpose',
  smoke: 'gateSmokePurpose',
}

export function localizedGatePurpose(name: string, language: CockpitLanguage): string {
  return cockpitMessages[language][gatePurposeKeys[name] ?? 'gateGenericPurpose']
}

export function snapshotRecovery(input: { lastRevision: number | undefined; eventRevision: number }): { kind: 'event' | 'snapshot' } {
  return input.lastRevision !== undefined && input.eventRevision === input.lastRevision + 1 ? { kind: 'event' } : { kind: 'snapshot' }
}

export function consumeLaunchFragment(href: string): { token: string; cleanUrl: string } {
  const url = new URL(href)
  if (!url.hash.startsWith('#')) throw new Error('launch token must be in fragment')
  const params = new URLSearchParams(url.hash.slice(1)); const token = params.get('launchToken')
  if (!token || !/^[a-f0-9]{32}$/i.test(token) || params.size !== 1) throw new Error('invalid fragment launch token')
  url.hash = ''
  return { token, cleanUrl: url.toString() }
}
