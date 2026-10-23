const ANDROID = /Android/i.test(navigator.userAgent)
const CAMERA_TIMEOUT_MS = 12_000

export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'timeout' | 'busy' | 'notfound' | 'failed'

/** Why the live camera can't even be asked for, or null. Like the microphone, it needs HTTPS. */
export function cameraUnavailable(): CameraProblem | null {
  if (!window.isSecureContext) return 'insecure'
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  return null
}

function errorName(e: unknown) {
  return e && typeof e === 'object' && 'name' in e ? String(e.name) : ''
}

export function cameraProblem(e: unknown): CameraProblem {
  switch (errorName(e)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'TimeoutError':
      return 'timeout'
    case 'NotReadableError':
    case 'AbortError':
      return 'busy'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notfound'
    case 'NotSupportedError':
      return 'unsupported'
    default:
      return 'failed'
  }
}

export function cameraMessage(problem: CameraProblem): { title: string; body: string } {
  switch (problem) {
    case 'insecure':
      return { title: 'The camera needs a secure connection', body: 'Open KhalkosPay over HTTPS to scan live. You can still take a photo of the code or type the shop code.' }
    case 'unsupported':
      return { title: "This app can't open the camera here", body: 'Take a photo of the code instead, or type the shop code printed under it.' }
    case 'denied':
      return {
        title: 'Camera access is off',
        body: ANDROID
          ? 'In Android Settings › Apps › Nimiq Pay › Permissions, set Camera to Allow, then try again. Or take a photo of the code.'
          : 'Allow the camera for Nimiq Pay in Settings, then try again. Or take a photo of the code.',
      }
    case 'timeout':
      return { title: "The camera didn't start", body: 'Nimiq Pay never answered the camera request. Try again, or take a photo of the code.' }
    case 'busy':
      return { title: 'The camera is busy', body: 'Close other apps using the camera and try again, or take a photo of the code.' }
    case 'notfound':
      return { title: 'No camera found', body: 'Take a photo of the code instead, or type the shop code printed under it.' }
    case 'failed':
      return { title: "Couldn't start the camera", body: 'Try again, or take a photo of the code.' }
  }
}

/** The back camera, without waiting forever: some WebViews never settle the permission request. */
export function openCamera(): Promise<MediaStream> {
  let timedOut = false
  const request = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  // A stream that arrives after the timeout would keep the camera on with nobody watching.
  void request.then((s) => timedOut && stopStream(s), () => {})
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      timedOut = true
      reject(new DOMException('No answer to the camera request', 'TimeoutError'))
    }, CAMERA_TIMEOUT_MS),
  )
  return Promise.race([request, timeout])
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}
