import { useState } from 'react';

interface Category {
  id: string;
  name: string;
  description: string;
  basic: boolean;
}

// Names follow videoCategories.list(regionCode=KR, hl=ko). Checked 2026-11-24 against
// chart=mostPopular in KR: 19 여행/이벤트, 27 교육, 29 비영리/사회운동 return notFound and
// 22 인물/블로그 returns only ~5 videos, so they are left out.
export const TRENDING_CATEGORIES: Category[] = [
  { id: 'all', name: '전체 인기', description: '카테고리 구분 없는 한국 인기 동영상', basic: true },
  { id: '10', name: '음악', description: '뮤직비디오, 라이브, 커버', basic: true },
  { id: '20', name: '게임', description: '게임 플레이, 리뷰, 공략', basic: true },
  { id: '24', name: '엔터테인먼트', description: '예능, 방송 클립, 연예', basic: true },
  { id: '25', name: '뉴스/정치', description: '시사, 정치, 사회 이슈', basic: true },
  { id: '23', name: '코미디', description: '개그, 상황극, 패러디', basic: true },
  { id: '26', name: '노하우/스타일', description: '요리, 뷰티, 생활 꿀팁', basic: true },
  { id: '17', name: '스포츠', description: '축구, 야구, 하이라이트', basic: false },
  { id: '1', name: '영화/애니메이션', description: '영화 리뷰, 애니, 예고편', basic: false },
  { id: '15', name: '반려동물/동물', description: '반려동물, 동물 영상', basic: false },
  { id: '28', name: '과학기술', description: 'IT, 과학, 신기술', basic: false },
  { id: '2', name: '자동차', description: '자동차 리뷰, 시승기', basic: false },
];

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

  const basicCategories = TRENDING_CATEGORIES.filter(category => category.basic);
  const advancedCategories = TRENDING_CATEGORIES.filter(category => !category.basic);

  return (
    <div className="mb-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">카테고리 선택</h5>
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
                    ? 'btn-dark'
                    : 'btn-outline-primary'
                }`}
                onClick={() => onCategorySelect(category.id)}
                disabled={loading}
                aria-pressed={activeCategory === category.id}
                title={category.description}
              >
                <div className="d-flex align-items-center">

                  <span className="small">{category.name}</span>
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
          <h6 className="text-muted mb-3">고급 카테고리</h6>
          <div className="row g-3">
            {advancedCategories.map(category => (
              <div key={category.id} className="col-md-6 col-lg-4 col-xl-3">
                <button
                  className={`btn w-100 text-start ${
                    activeCategory === category.id
                      ? 'btn-dark'
                      : 'btn-outline-primary'
                  }`}
                  onClick={() => onCategorySelect(category.id)}
                  disabled={loading}
                aria-pressed={activeCategory === category.id}
                  title={category.description}
                >
                  <div className="d-flex align-items-center">

                    <span className="small">{category.name}</span>
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
                .find(cat => cat.id === activeCategory)?.name || '전체 인기'
            } • {
              [...basicCategories, ...advancedCategories]
                .find(cat => cat.id === activeCategory)?.description || '카테고리 구분 없는 한국 인기 동영상'
            }
          </small>
        </div>
      )}
    </div>
  );
};

export default TrendingCategories;
