import { useState, useEffect } from 'react';
import {
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  getFolderChannelCount,
  getFavoriteChannelCount,
  type FavoriteFolder,
} from '../utils/supabaseFavorites';

interface FolderManagerProps {
  onSelectFolder: (folderId: string | null) => void;
  selectedFolderId: string | null;
  refreshKey?: number;
}

export default function FolderManager({ onSelectFolder, selectedFolderId, refreshKey = 0 }: FolderManagerProps) {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FavoriteFolder | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#6c757d');
  const [newFolderIcon, setNewFolderIcon] = useState('📁');

  useEffect(() => {
    loadFolders();
  }, [refreshKey]);

  const loadFolders = async () => {
    const data = await getFolders();
    setFolders(data);
    setTotalCount(await getFavoriteChannelCount());

    // 각 폴더의 채널 개수 로드
    const counts: Record<string, number> = {};
    for (const folder of data) {
      counts[folder.id] = await getFolderChannelCount(folder.id);
    }
    setFolderCounts(counts);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      alert('폴더 이름을 입력하세요.');
      return;
    }

    const result = await createFolder({
      name: newFolderName,
      description: newFolderDescription,
      color: newFolderColor,
      icon: newFolderIcon,
    });

    if (result) {
      setShowCreateModal(false);
      resetForm();
      await loadFolders();
    } else {
      alert('폴더 생성에 실패했습니다.');
    }
  };

  const handleUpdateFolder = async () => {
    if (!editingFolder) return;

    const success = await updateFolder(editingFolder.id, {
      name: newFolderName,
      description: newFolderDescription,
      color: newFolderColor,
      icon: newFolderIcon,
    });

    if (success) {
      setEditingFolder(null);
      resetForm();
      await loadFolders();
    } else {
      alert('폴더 수정에 실패했습니다.');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('폴더를 삭제하시겠습니까? (채널은 미분류로 이동됩니다)')) {
      return;
    }

    const success = await deleteFolder(folderId);
    if (success) {
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
      await loadFolders();
    } else {
      alert('폴더 삭제에 실패했습니다.');
    }
  };

  const resetForm = () => {
    setNewFolderName('');
    setNewFolderDescription('');
    setNewFolderColor('#6c757d');
    setNewFolderIcon('📁');
  };

  const openEditModal = (folder: FavoriteFolder) => {
    setEditingFolder(folder);
    setNewFolderName(folder.name);
    setNewFolderDescription(folder.description || '');
    setNewFolderColor(folder.color);
    setNewFolderIcon(folder.icon);
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingFolder(null);
    resetForm();
  };

  const commonIcons = ['📁', '📂', '🎬', '🎥', '📺', '🎭', '🎪', '🎨', '🎵', '🎮', '⭐', '🔥', '💡', '📚', '🏆'];
  const commonColors = [
    '#6c757d', '#dc3545', '#fd7e14', '#ffc107', '#28a745',
    '#20c997', '#17a2b8', '#007bff', '#6610f2', '#e83e8c'
  ];

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          {/* 전체 보기 버튼 */}
          <button
            className={`btn ${!selectedFolderId ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => onSelectFolder(null)}
          >
            📚 전체
            <span className="badge bg-light text-dark ms-2">
              {totalCount}
            </span>
          </button>

          {/* 폴더 버튼들 */}
          {folders.map((folder) => (
            <div key={folder.id} className="btn-group">
              <button
                className={`btn ${
                  selectedFolderId === folder.id ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => onSelectFolder(folder.id)}
                title={folder.description || folder.name}
              >
                {folder.icon} {folder.name}
                <span
                  className="badge ms-2"
                  style={{
                    backgroundColor: selectedFolderId === folder.id ? '#fff' : folder.color,
                    color: selectedFolderId === folder.id ? folder.color : '#fff'
                  }}
                >
                  {folderCounts[folder.id] || 0}
                </span>
              </button>
              <button
                className={`btn ${
                  selectedFolderId === folder.id ? 'btn-primary' : 'btn-outline-secondary'
                } dropdown-toggle dropdown-toggle-split`}
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                <span className="visually-hidden">Toggle Dropdown</span>
              </button>
              <ul className="dropdown-menu">
                <li>
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(folder);
                    }}
                  >
                    ✏️ 수정
                  </button>
                </li>
                <li>
                  <button
                    className="dropdown-item text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder.id);
                    }}
                  >
                    🗑️ 삭제
                  </button>
                </li>
              </ul>
            </div>
          ))}

          {/* 새 폴더 만들기 버튼 */}
          <button
            className="btn btn-success"
            onClick={() => setShowCreateModal(true)}
            title="새 폴더 만들기"
          >
            + 폴더
          </button>
        </div>
      </div>

      {/* 폴더 생성/수정 모달 */}
      {showCreateModal && (
        <>
          <div
            className="modal-backdrop fade show"
            onClick={closeModal}
            style={{ zIndex: 1040 }}
          />
          <div
            className="modal fade show d-block"
            tabIndex={-1}
            style={{ zIndex: 1050 }}
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    {editingFolder ? '폴더 수정' : '새 폴더 만들기'}
                  </h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={closeModal}
                  />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">폴더 이름 *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="예: 엔터테인먼트"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">설명</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newFolderDescription}
                      onChange={(e) => setNewFolderDescription(e.target.value)}
                      placeholder="폴더에 대한 간단한 설명"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">아이콘</label>
                    <div className="d-flex gap-2 mb-2 flex-wrap">
                      {commonIcons.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          className={`btn ${newFolderIcon === icon ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => setNewFolderIcon(icon)}
                          style={{ fontSize: '1.5rem', padding: '0.25rem 0.75rem' }}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="form-control"
                      value={newFolderIcon}
                      onChange={(e) => setNewFolderIcon(e.target.value)}
                      placeholder="이모지 입력"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">색상</label>
                    <div className="d-flex gap-2 mb-2 flex-wrap">
                      {commonColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="btn p-0"
                          onClick={() => setNewFolderColor(color)}
                          style={{
                            width: '40px',
                            height: '40px',
                            backgroundColor: color,
                            border: newFolderColor === color ? '3px solid #000' : '1px solid #ddd',
                            borderRadius: '4px',
                          }}
                        />
                      ))}
                    </div>
                    <input
                      type="color"
                      className="form-control form-control-color w-100"
                      value={newFolderColor}
                      onChange={(e) => setNewFolderColor(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeModal}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={editingFolder ? handleUpdateFolder : handleCreateFolder}
                  >
                    {editingFolder ? '수정' : '생성'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
