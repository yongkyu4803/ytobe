import { useState } from 'react';

interface Category {
  id: string;
  name: string;
  icon: string;
  description?: string;
}

interface TrendingCategoriesProps {
  onCategorySelect: (categoryId: string) => void;
  loading: boolean;
  activeCategory: string;
}

const TrendingCategories: React.FC<TrendingCategoriesProps> = ({ 
  onCategorySelect, 
  loading, 
  activeCategory 
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const basicCategories: Category[] = [
    { id: 'all', name: '🔥 전체 급상승', icon: '🔥', description: '전체 카테고리 인기 동영상' },
    { id: '10', name: '🎵 음악', icon: '🎵', description: 'K-POP, 인디, 클래식 등' },
    { id: '20', name: '🎮 게임', icon: '🎮', description: '게임 플레이, 리뷰, 공략' },
    { id: '24', name: '📺 엔터테인먼트', icon: '📺', description: '예능, 드라마, 영화' },
    { id: '25', name: '📰 뉴스/정치', icon: '📰', description: '시사, 정치, 사회 이슈' },
    { id: '26', name: '🍳 요리/라이프', icon: '🍳', description: '요리, 일상, 라이프스타일' },
  ];

  const advancedCategories: Category[] = [
    { id: '22', name: '👥 인물/블로그', icon: '👥', description: '브이로그, 인터뷰, 토크' },
    { id: '27', name: '🎓 교육', icon: '🎓', description: '강의, 튜토리얼, 학습' },
    { id: '28', name: '🔬 과학/기술', icon: '🔬', description: 'IT, 과학, 신기술' },
    { id: '15', name: '🐾 동물', icon: '🐾', description: '펫, 동물, 자연 다큐' },
    { id: '17', name: '⚽ 스포츠', icon: '⚽', description: '축구, 야구, 올림픽' },
    { id: '19', name: '✈️ 여행', icon: '✈️', description: '여행, 관광, 문화 체험' },
  ];

  return (
    <div className="mb-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">📂 카테고리 선택</h5>
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '기본 카테고리만' : '더 많은 카테고리'}
        </button>
      </div>

      {/* 기본 카테고리 */}
      <div className="mb-3">
        <div className="row g-3">
          {basicCategories.map(category => (
            <div key={category.id} className="col-md-6 col-lg-4 col-xl-3">
              <button
                className={`btn w-100 text-start ${
                  activeCategory === category.id 
                    ? 'btn-primary' 
                    : 'btn-outline-primary'
                }`}
                onClick={() => onCategorySelect(category.id)}
                disabled={loading}
                title={category.description}
              >
                <div className="d-flex align-items-center">
                  <span className="me-2">{category.icon}</span>
                  <span className="small">{category.name.replace(category.icon + ' ', '')}</span>
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 고급 카테고리 */}
      {showAdvanced && (
        <div className="mb-3">
          <hr className="my-3" />
          <h6 className="text-muted mb-3">🎯 고급 카테고리</h6>
          <div className="row g-3">
            {advancedCategories.map(category => (
              <div key={category.id} className="col-md-6 col-lg-4 col-xl-3">
                <button
                  className={`btn w-100 text-start ${
                    activeCategory === category.id 
                      ? 'btn-primary' 
                      : 'btn-outline-primary'
                  }`}
                  onClick={() => onCategorySelect(category.id)}
                  disabled={loading}
                  title={category.description}
                >
                  <div className="d-flex align-items-center">
                    <span className="me-2">{category.icon}</span>
                    <span className="small">{category.name.replace(category.icon + ' ', '')}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 현재 선택된 카테고리 정보 */}
      {activeCategory && (
        <div className="alert alert-info py-2">
          <small>
            <strong>현재 선택:</strong> {
              [...basicCategories, ...advancedCategories]
                .find(cat => cat.id === activeCategory)?.name || '전체 급상승'
            } • {
              [...basicCategories, ...advancedCategories]
                .find(cat => cat.id === activeCategory)?.description || '모든 카테고리의 인기 동영상'
            }
          </small>
        </div>
      )}
    </div>
  );
};

export default TrendingCategories;