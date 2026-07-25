interface SquareCarouselPreviewProps {
  title: string;
}

export function SquareCarouselPreview({ title }: SquareCarouselPreviewProps) {
  return (
    <div className="square-carousel-preview" aria-label="Instagram 정방형 카드뉴스 미리보기">
      <div className="square-slide">{title}</div>
      <div className="slide-strip" aria-label="슬라이드 번호">
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
      <p className="muted small">Instagram 카드뉴스 · 1080 x 1080 정방형 슬라이드</p>
    </div>
  );
}
