if (typeof (globalThis as any).DragEvent === 'undefined') {
  class MockDragEvent extends Event {}
  (globalThis as any).DragEvent = MockDragEvent;
}
