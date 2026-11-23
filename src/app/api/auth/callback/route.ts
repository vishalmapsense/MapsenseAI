import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Return to the specified URL or fallback to the root
      return NextResponse.redirect(`${origin}${next}`)
    } else {
      console.error("Supabase auth error:", error)
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/?error=auth-failed`)
}
