import { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import NotificationDropdown from './NotificationDropdown';
import GqaiIcon from './GqaiIcon';

const navigation = [
  { href: '/', label: '키워드 검색', icon: 'action-search' },
  { href: '/trending', label: '인기 추천', icon: 'content-data-dashboard' },
  { href: '/favorites', label: '즐겨찾기', icon: 'content-archive' },
  { href: '/rising', label: '급상승 영상', icon: 'content-analysis-report' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 이동</a>
      <header className="app-header">
        <div className="app-container header-inner">
          <Link href="/" className="brand" aria-label="YouTube Analytics 홈">
            <span className="brand-mark"><GqaiIcon name="content-data-dashboard" size={28} /></span>
            <span><span className="brand-title">YouTube Analytics</span><span className="brand-description">인기 동영상 검색 및 성과 분석</span></span>
          </Link>
          <NotificationDropdown />
        </div>
        <nav className="app-container" aria-label="주 메뉴">
          <ul className="app-nav">
            {navigation.map(item => <li key={item.href}>
              <Link href={item.href} className={router.pathname === item.href ? 'active' : ''} aria-current={router.pathname === item.href ? 'page' : undefined}>
                <GqaiIcon name={item.icon} />{item.label}
              </Link>
            </li>)}
          </ul>
        </nav>
      </header>
      <main id="main-content" className="app-container app-main">{children}</main>
      <footer className="app-footer"><div className="app-container footer-inner"><span>YouTube Analytics</span><small>Powered by YouTube Data API v3</small></div></footer>
    </div>
  );
}
