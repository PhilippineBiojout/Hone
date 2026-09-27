/** Only these deliberately authored messages may cross the plugin boundary. */
export class ErreurOcr extends Error {
  constructor(message: string) { super(message); this.name = 'ErreurOcr'; }
}
