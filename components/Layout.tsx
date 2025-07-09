import { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const router = useRouter();

  return (
    <div className="min-vh-100">
      {/* Header */}
      <header className="bg-primary text-white py-3 shadow-sm">
        <div className="container-fluid" style={{ maxWidth: '2000px', margin: '0 auto' }}>
          <div className="row align-items-center" style={{ paddingLeft: 'max(1.5rem, 2vw)', paddingRight: 'max(1.5rem, 2vw)' }}>
            <div className="col">
              <h1 className="h4 mb-0 fw-bold">🎯 YouTube Analytics</h1>
              <small className="text-light opacity-75">인기 동영상 검색 및 성과 분석</small>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-light border-bottom">
        <div className="container-fluid" style={{ maxWidth: '2000px', margin: '0 auto' }}>
          <div style={{ paddingLeft: 'max(1.5rem, 2vw)', paddingRight: 'max(1.5rem, 2vw)' }}>
            <ul className="nav nav-pills py-3">
              <li className="nav-item">
                <Link href="/" className={`nav-link ${router.pathname === '/' ? 'active' : ''}`}>
                  🔍 키워드 검색
                </Link>
              </li>
              <li className="nav-item">
                <Link href="/trending" className={`nav-link ${router.pathname === '/trending' ? 'active' : ''}`}>
                  🎯 인기 추천
                </Link>
              </li>
              <li className="nav-item">
                <Link href="/analytics" className={`nav-link ${router.pathname === '/analytics' ? 'active' : ''} disabled`}>
                  📊 트렌드 분석 <small className="text-muted">(준비중)</small>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container-fluid py-4" style={{ maxWidth: '2000px', margin: '0 auto' }}>
        <div style={{ paddingLeft: 'max(1.5rem, 2vw)', paddingRight: 'max(1.5rem, 2vw)' }}>
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-light text-center py-3 mt-auto border-top">
        <div className="container-fluid">
          <small className="text-muted">
            © 2024 YouTube Analytics • Powered by YouTube Data API v3
          </small>
        </div>
      </footer>
    </div>
  );
};

export default Layout;