import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

const users = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  name: `user_${String(index)}_name`,
  email: `user${String(index)}@example.com`,
}));

@Component({
  selector: 'parity-table',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" width="100%" maxWidth="80">
      <ink-box>
        <ink-box width="10%"><ink-text>ID</ink-text></ink-box>
        <ink-box width="50%"><ink-text>Name</ink-text></ink-box>
        <ink-box width="40%"><ink-text>Email</ink-text></ink-box>
      </ink-box>
      @for (user of users; track user.id) {
        <ink-box>
          <ink-box width="10%">
            <ink-text>{{ user.id }}</ink-text>
          </ink-box>
          <ink-box width="50%">
            <ink-text>{{ user.name }}</ink-text>
          </ink-box>
          <ink-box width="40%">
            <ink-text>{{ user.email }}</ink-text>
          </ink-box>
        </ink-box>
      }
    </ink-box>
  `,
})
class Table {
  protected readonly users = users;
}

void renderInk(Table);
