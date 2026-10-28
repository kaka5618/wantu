import { useState } from "react";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  MagicWandIcon,
  MoveIcon,
  ReloadIcon,
  Share1Icon,
  StarIcon,
  SunIcon,
  HeartIcon,
  ArrowTopRightIcon,
  TextAlignCenterIcon,
} from "@radix-ui/react-icons";
import { MobileScroll } from "./mobile";

const captions = ["今日探险\n小小勇士\n超棒！", "今天也超勇敢", "森林里的\n小小探险家"];

export default function Prototype() {
  const [captionIndex, setCaptionIndex] = useState(0);
  const [minimal, setMinimal] = useState(false);
  const [moved, setMoved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [variant, setVariant] = useState(0);

  const caption = captions[(captionIndex + variant) % captions.length];
  const lines = caption.split("\n");

  function regenerate() {
    setVariant((value) => value + 1);
    setMinimal(false);
    setMoved(false);
    setSaved(false);
  }

  return (
    <MobileScroll className="app-screen">
      <main className="plog-screen" aria-label="写进照片 PLOG 编辑页">
        <header className="editor-header">
          <button className="icon-button" aria-label="返回">
            <ArrowLeftIcon width={25} height={25} />
          </button>
          <div className="editor-title">你的 PLOG<span className="tiny-star"><StarIcon width={16} height={16} /></span></div>
          <button className="regenerate-button" onClick={regenerate}>
            <ReloadIcon width={17} height={17} />
            重新生成
          </button>
        </header>

        <section className="photo-stage" aria-label="已生成的手写 PLOG 图片">
          <img className="source-photo" src="/assets/content/adventure-child.jpg" alt="戴头盔的孩子在森林绳网桥上探险" />
          <div className={`photo-copy copy-top ${moved ? "copy-shift" : ""}`}>
            {lines.map((line) => <span key={line}>{line}</span>)}
            <i className="copy-swoosh" />
          </div>
          {!minimal && <>
            <div className="sun-doodle"><SunIcon width={49} height={49} /></div>
            <div className="heart-doodle"><HeartIcon width={39} height={39} /></div>
            <div className="photo-copy copy-left">勇敢<br />就是<br />向前走</div>
            <div className="copy-arrow"><ArrowTopRightIcon width={44} height={44} /></div>
          </>}
          <div className="ai-signature"><MagicWandIcon width={15} height={15} /> 写进照片 · AI 辅助创作</div>
        </section>

        <section className="quick-edits" aria-label="快速编辑">
          <button className="quick-edit" onClick={() => { setCaptionIndex((value) => value + 1); setSaved(false); }}>
            <TextAlignCenterIcon width={22} height={22} />
            <span>换句文案</span>
          </button>
          <button className={`quick-edit ${minimal ? "is-active" : ""}`} onClick={() => { setMinimal((value) => !value); setSaved(false); }}>
            <MagicWandIcon width={22} height={22} />
            <span>少一点</span>
          </button>
          <button className={`quick-edit ${moved ? "is-active" : ""}`} onClick={() => { setMoved((value) => !value); setSaved(false); }}>
            <MoveIcon width={22} height={22} />
            <span>移动文字</span>
          </button>
        </section>

        <button className={`save-button ${saved ? "saved" : ""}`} onClick={() => setSaved(true)}>
          {saved ? <CheckCircledIcon width={25} height={25} /> : <Share1Icon width={25} height={25} />}
          {saved ? "已保存到相册" : "保存并分享"}
        </button>
        <p className="preserve-note"><CheckCircledIcon width={15} height={15} /> 已为你保留原照片</p>
        <button className="make-another" onClick={regenerate}>做另一版 <StarIcon width={15} height={15} /></button>
        <button className="work-link">查看我的作品 <ChevronRightIcon width={16} height={16} /></button>
      </main>
    </MobileScroll>
  );
}
