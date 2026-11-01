import { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import NotificationDropdown from './NotificationDropdown';

const navigation = [
  { href: '/', label: '키워드 검색' },
  { href: '/trending', label: '인기 추천' },
  { href: '/favorites', label: '즐겨찾기' },
  { href: '/rising', label: '급상승 영상' },
  { href: '/channels', label: '채널 탐색' },
  { href: '/keywords', label: '인기 키워드' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 이동</a>
      <header className="app-header">
        <div className="app-container header-inner">
          <Link href="/" className="brand" aria-label="YouTube Analytics 홈">
            <span><span className="brand-title">YouTube Analytics</span><span className="brand-description">인기 동영상 검색 및 성과 분석</span></span>
          </Link>
          <NotificationDropdown />
        </div>
        <nav className="app-container" aria-label="주 메뉴">
          <ul className="app-nav">
            {navigation.map(item => { const active = router.pathname === item.href || (item.href !== '/' && router.pathname.startsWith(`${item.href}/`)); return <li key={item.href}>
              <Link href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
            </li>; })}
          </ul>
        </nav>
      </header>
      <main id="main-content" className="app-container app-main">{children}</main>
      <footer className="app-footer"><div className="app-container footer-inner"><span>YouTube Analytics</span><small>Powered by YouTube Data API v3 · <a href="https://www.kimm.re.kr/webfont" target="_blank" rel="noreferrer">서체 출처: 한국기계연구원 (2022), 공공누리 제1유형</a></small></div></footer>
    </div>
  );
}
