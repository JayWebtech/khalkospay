import { useState } from 'react'
import { BrandMark } from '@/components/brand-mark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { adminLogin, useAdminSession } from '@/lib/admin'

export function AdminLoginPage() {
  const endedReason = useAdminSession((s) => s.endedReason)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminLogin(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandMark className="mb-2" />
          <CardTitle className="font-heading text-lg">KhalkosPay admin</CardTitle>
          <CardDescription>Sign in with your operator account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {(error || endedReason) && (
              <Alert variant={error ? 'destructive' : 'default'}>
                <AlertDescription>{error ?? endedReason}</AlertDescription>
              </Alert>
            )}
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="admin-email">Email</FieldLabel>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-password">Password</FieldLabel>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                />
              </Field>
            </FieldGroup>
            <Button type="submit" size="lg" disabled={busy || !email || !password}>
              {busy && <Spinner />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
