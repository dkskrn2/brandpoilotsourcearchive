import { useSearchParams } from "react-router-dom";

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get("error");
  const errorMessage = error === "kakao_state_mismatch"
    ? "로그인 상태 확인에 실패했습니다. localhost 주소로 다시 시도하세요."
    : error === "kakao_token_exchange_failed"
      ? "카카오 토큰 발급에 실패했습니다. Client Secret 설정을 확인하세요."
      : error === "kakao_authorization_denied"
        ? "카카오 로그인 또는 동의가 취소되었습니다."
        : error ? "카카오 로그인 설정을 확인하세요." : null;

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><span>BP</span> Brand Pilot</div>
        <h1 id="login-title">콘텐츠 운영을 시작하세요</h1>
        <p>카카오 계정으로 로그인하면 개인 워크스페이스와 첫 브랜드가 생성됩니다.</p>
        {errorMessage ? <p className="login-error">{errorMessage}</p> : null}
        <a className="kakao-login" href={`${apiBaseUrl()}/auth/kakao/login`}>
          <span aria-hidden="true">K</span> 카카오로 시작하기
        </a>
      </section>
    </main>
  );
}
