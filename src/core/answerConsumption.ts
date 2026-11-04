/** A monotonic observation, separate from live resource capabilities or authority. */
export class AnswerConsumption {
  private confirmed = false;
  get consumed(): boolean {
    return this.confirmed;
  }
  /** May become known after native retirement; never opens or closes resources. */
  record(): void {
    this.confirmed = true;
  }
}
