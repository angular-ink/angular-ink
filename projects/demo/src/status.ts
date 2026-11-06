import { Component, computed, input } from '@angular/core';
import {
  InkBox,
  InkText,
  injectApp,
  injectInput,
  injectStdin,
  injectStdout,
  injectWindowSize,
  renderInk,
} from '@angular-ink/core';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Service {
  readonly name: string;
  readonly region: string;
  readonly state: 'ok' | 'degraded' | 'down';
  readonly latencyMs: number;
}

const SERVICES: readonly Service[] = [
  { name: 'api-gateway', region: 'eu-west', state: 'ok', latencyMs: 42 },
  { name: 'billing', region: 'eu-west', state: 'ok', latencyMs: 87 },
  { name: 'catalog', region: 'us-east', state: 'degraded', latencyMs: 640 },
  { name: 'notifications', region: 'us-east', state: 'ok', latencyMs: 55 },
  { name: 'search', region: 'ap-south', state: 'down', latencyMs: 0 },
  { name: 'worker', region: 'ap-south', state: 'ok', latencyMs: 12 },
];

const STATE_COLORS: Readonly<Record<Service['state'], string>> = {
  ok: 'green',
  degraded: 'yellow',
  down: 'red',
};

// Below this the table gives up the region to keep the names readable.
const MIN_COLUMNS_FOR_REGION = 60;

/** One line of the table. The first column takes what the fixed ones leave. */
@Component({
  selector: 'demo-status-row',
  imports: [InkBox, InkText],
  template: `
    <ink-box>
      <ink-box flexGrow="1" flexBasis="0">
        <ink-text wrap="truncate-end" [bold]="bold()">{{ name() }}</ink-text>
      </ink-box>
      @if (region(); as text) {
        <ink-text> │ </ink-text>
        <ink-box width="10">
          <ink-text wrap="truncate-end" [bold]="bold()">{{ text }}</ink-text>
        </ink-box>
      }
      <ink-text> │ </ink-text>
      <ink-box width="8">
        <ink-text [bold]="bold()" [color]="stateColor()">{{ state() }}</ink-text>
      </ink-box>
      <ink-text> │ </ink-text>
      <ink-box width="7" justifyContent="flex-end">
        <ink-text [bold]="bold()">{{ latency() }}</ink-text>
      </ink-box>
    </ink-box>
  `,
})
class StatusRow {
  readonly name = input.required<string>();
  readonly region = input<string | null>(null);
  readonly state = input.required<string>();
  readonly latency = input.required<string>();
  readonly stateColor = input<string>();
  readonly bold = input(false);
}

/** A table of services that follows the size of the terminal. In a pipe it prints and ends. */
@Component({
  selector: 'demo-status',
  imports: [InkBox, InkText, StatusRow],
  template: `
    <ink-box flexDirection="column">
      <ink-box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX="1">
        <demo-status-row
          name="Service"
          [region]="showRegion() ? 'Region' : null"
          state="State"
          latency="Latency"
          [bold]="true"
        />
        @for (service of services(); track $index) {
          <demo-status-row
            [name]="service.name"
            [region]="showRegion() ? service.region : null"
            [state]="service.state"
            [stateColor]="colors[service.state]"
            [latency]="service.state === 'down' ? '-' : service.latencyMs + ' ms'"
          />
        }
      </ink-box>
      @if (live) {
        <ink-text dimColor>{{ size().columns }}x{{ size().rows }} · q to quit</ink-text>
      }
    </ink-box>
  `,
})
export class Status {
  readonly services = input<readonly Service[]>(SERVICES);

  protected readonly colors = STATE_COLORS;
  protected readonly size = injectWindowSize();
  protected readonly showRegion = computed(() => this.size().columns >= MIN_COLUMNS_FOR_REGION);
  /** With stdout in a pipe nobody sees the table change, so no key is worth waiting for. */
  protected readonly live =
    (injectStdout().stdout as Partial<NodeJS.WriteStream>).isTTY === true &&
    injectStdin().isRawModeSupported;

  private readonly app = injectApp();

  constructor() {
    injectInput(
      (text) => {
        if (text === 'q') this.app.exit();
      },
      { isActive: this.live },
    );
  }
}

async function main(): Promise<void> {
  const dataFlag = process.argv.indexOf('--data');
  const dataFile = dataFlag === -1 ? undefined : process.argv[dataFlag + 1];
  const app = await renderInk(Status, {
    inputs:
      dataFile === undefined
        ? {}
        : { services: JSON.parse(readFileSync(dataFile, 'utf8')) as readonly Service[] },
  });
  await app.waitUntilExit();
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
