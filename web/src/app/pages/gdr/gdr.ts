import { gdrAdventureIcon } from '../../core/gdr-adventure-icons';
import { Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SafeModeService } from '../../core/safe-mode.service';
import { AuthService } from '../../core/auth.service';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { AppShell } from '../../shell/app-shell';
import { EditorialText } from '../../shared/editorial-text/editorial-text';

@Component({
  selector: 'app-gdr',
  standalone: true,
  imports: [ RouterLink, AppShell, EditorialText],
  providers: [GdrWorkspaceService],
  styleUrls: ['../../../styles/pages/tavolo.css'],
  templateUrl: './gdr.html',
})
export class Gdr implements OnInit {
  protected readonly adventureIcon = gdrAdventureIcon;
  protected readonly safe = inject(SafeModeService);
  protected readonly classic = inject(ActivatedRoute).snapshot.data['classic'] === true;
  private readonly auth = inject(AuthService);
  protected readonly workspace = inject(GdrWorkspaceService);
  protected readonly canManagePowers = computed(() => !this.safe.enabled() && this.auth.isAdmin() && !this.auth.currentUser()?.isTest && this.auth.adminModeEnabled());
  protected readonly customAdventures = computed(() =>
    this.workspace.adventures().filter((a) => !a.legacy),
  );
  async ngOnInit(): Promise<void> {
    if (!this.classic) await this.workspace.load('il-prezzo-della-verita');
  }
}
