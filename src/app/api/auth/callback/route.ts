import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cookies, headers } from 'next/headers'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/'

  // Resolve the actual public origin behind reverse proxies (AWS Amplify, CloudFront, etc.)
  const headerList = await headers()
  const forwardedHost = headerList.get('x-forwarded-host') || headerList.get('host')
  const forwardedProto = headerList.get('x-forwarded-proto') || 'https'
  
  let origin = process.env.NEXT_PUBLIC_SITE_URL || ''
  if (!origin && forwardedHost && !forwardedHost.includes('localhost')) {
    origin = `${forwardedProto}://${forwardedHost}`
  }
  
  // In production, if origin still resolves to localhost (due to internal proxy),
  // force the public production domain.
  if (!origin || (process.env.NODE_ENV === 'production' && origin.includes('localhost'))) {
    origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://main.d2df50755xi4a7.amplifyapp.com'
  }
  if (!origin) {
    origin = requestUrl.origin
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Return to the specified URL or fallback to the root
      return NextResponse.redirect(`${origin}${next}`)
    } else {
      console.error("Supabase auth error:", error)
      return NextResponse.redirect(`${origin}/?error=auth-failed`)
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/?error=no-code`)
}
