"use client";

export function AdminDeleteButton({ action }: { action: () => void | Promise<void> }) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm("이 콘텐츠를 삭제할까요? 삭제한 내용은 복구할 수 없습니다.")) event.preventDefault(); }}><button className="admin-delete-button" type="submit">콘텐츠 삭제</button></form>;
}
