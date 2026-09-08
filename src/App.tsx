import { useMemo, useState } from 'react'

export function clampTilt(value: number) {
  return Math.max(-10, Math.min(10, value))
}

export default function App() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const transform = useMemo(
    () => `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
    [tilt],
  )

  return (
    <main
      className="stage"
      onMouseMove={(event) => {
        const x = (event.clientY / window.innerHeight - 0.5) * -14
        const y = (event.clientX / window.innerWidth - 0.5) * 14
        setTilt({ x: clampTilt(x), y: clampTilt(y) })
      }}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <section className="hero">
        <p className="eyebrow">VIBE CODING PLAYGROUND</p>
        <h1>말로 만들고,<br />실험으로 키운다.</h1>
        <p className="description">
          이 프로젝트는 AI가 스스로 만들고, 테스트하고, 실패하면 다른 방법을 시도하도록 설계된 취미용 출발점입니다.
        </p>

        <div className="card-wrap">
          <article className="tilt-card" style={{ transform }} data-testid="tilt-card">
            <span className="chip">AUTO EXPERIMENT</span>
            <h2>첫 번째 3D 인터랙션</h2>
            <p>마우스를 움직여 보세요. 이 정도의 작은 실험은 AI가 별도 확인 없이 추가할 수 있습니다.</p>
            <div className="orb" />
          </article>
        </div>
      </section>
    </main>
  )
}
