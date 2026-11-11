// Fireworks over a holiday's rest card (iOS ScheduleFireworks): a few bursts of sparks that rise,
// open, fall and fade in about three seconds. Drawn on a canvas; nothing is touchable.

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
}

const COLORS: string[] = ['#F43F5E', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#14B8A6', '#FACC15'];
const LIFETIME: number = 1500;
const DURATION: number = 3400;

@Component
export struct ScheduleFireworks {
  // Changing it starts a new show.
  @Prop @Watch('start') startedAt: number = 0;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private context: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private sparks: Spark[] = [];
  private timer: number = -1;
  private began: number = 0;
  private bursts: number = 0;
  private areaWidth: number = 360;
  private areaHeight: number = 600;

  aboutToDisappear(): void { clearInterval(this.timer); }

  build() {
    Canvas(this.context).width('100%').height('100%').hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
      .onReady(() => this.start())
      .onAreaChange((_old: Area, next: Area) => { this.areaWidth = Number(next.width); this.areaHeight = Number(next.height); })
  }

  private start(): void {
    if (!this.startedAt) return;
    clearInterval(this.timer);
    this.sparks = [];
    this.bursts = 0;
    this.began = Date.now();
    this.timer = setInterval(() => this.frame(), 16);
  }

  private burst(now: number): void {
    const x = this.areaWidth * (0.2 + 0.6 * Math.random());
    const y = this.areaHeight * (0.15 + 0.3 * Math.random());
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let index = 0; index < 34; index += 1) {
      const angle = (Math.PI * 2 * index) / 34 + Math.random() * 0.2;
      const speed = 1.6 + Math.random() * 1.8;
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color: index % 5 === 0 ? COLORS[Math.floor(Math.random() * COLORS.length)] : color, born: now });
    }
  }

  private frame(): void {
    const now = Date.now();
    const elapsed = now - this.began;
    // Five bursts, one every 380 ms.
    while (this.bursts < 5 && elapsed >= this.bursts * 380) {
      this.burst(now);
      this.bursts += 1;
    }
    this.context.clearRect(0, 0, this.areaWidth, this.areaHeight);
    this.sparks = this.sparks.filter((spark: Spark) => now - spark.born < LIFETIME);
    this.sparks.forEach((spark: Spark) => {
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vy += 0.045;
      spark.vx *= 0.985;
      const life = 1 - (now - spark.born) / LIFETIME;
      this.context.globalAlpha = Math.max(0, life);
      this.context.fillStyle = spark.color;
      this.context.beginPath();
      this.context.arc(spark.x, spark.y, 1.2 + 1.6 * life, 0, Math.PI * 2);
      this.context.fill();
    });
    this.context.globalAlpha = 1;
    if (elapsed > DURATION && !this.sparks.length) {
      clearInterval(this.timer);
      this.context.clearRect(0, 0, this.areaWidth, this.areaHeight);
    }
  }
}
