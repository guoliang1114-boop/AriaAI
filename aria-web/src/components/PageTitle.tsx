import { Helmet } from 'react-helmet-async'

interface PageTitleProps {
  title: string
  suffix?: string
}

export function PageTitle({ title, suffix = 'Aria AI' }: PageTitleProps) {
  const fullTitle = title ? `${title} · ${suffix}` : suffix
  return (
    <Helmet>
      <title>{fullTitle}</title>
    </Helmet>
  )
}
