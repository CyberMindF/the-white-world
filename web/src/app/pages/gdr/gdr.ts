import { gdrAdventureIcon } from '../../core/gdr-adventure-icons';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SafeModeService } from '../../core/safe-mode.service';
import { AuthService } from '../../core/auth.service';
import { GdrWorkspaceService } from '../../core/gdr-workspace.service';
import { AppShell } from '../../shell/app-shell';
import { EditorialText } from '../../shared/editorial-text/editorial-text';

@Component({
  selector: 'app-gdr',
  standalone: true,
  imports: [FormsModule, RouterLink, AppShell, EditorialText],
  providers: [GdrWorkspaceService],
  styleUrls: ['../../../styles/pages/tavolo.css'],
  templateUrl: './gdr.html',
})
export class Gdr implements OnInit {
  protected readonly adventureIcon = gdrAdventureIcon;
  protected readonly safe = inject(SafeModeService);
  protected readonly management = inject(ActivatedRoute).snapshot.data['management'] === true;
  protected readonly classic = inject(ActivatedRoute).snapshot.data['classic'] === true;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly workspace = inject(GdrWorkspaceService);
  protected readonly canCreate = computed(
    () => this.management && this.canManagePowers(),
  );
  protected readonly canManagePowers = computed(() => !this.safe.enabled() && this.auth.isAdmin() && !this.auth.currentUser()?.isTest && this.auth.adminModeEnabled());
  protected readonly customAdventures = computed(() =>
    this.workspace.adventures().filter((a) => !a.legacy),
  );
  protected readonly createOpen = signal(false);
  protected readonly title = signal('');
  protected readonly systemId = signal('');
  protected readonly systems = signal<{id:string;name:string}[]>([]);
  private newAdventureId = crypto.randomUUID();

  async ngOnInit(): Promise<void> {
    if (!this.classic) await this.workspace.load('il-prezzo-della-verita');
    if(this.canCreate())try{const response=await fetch('/api/gdr-systems',{credentials:'same-origin'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sistemi non disponibili.');this.systems.set(data.systems);}catch(error){this.workspace.error.set(error instanceof Error?error.message:'Sistemi non disponibili.');}
  }
  protected async createAdventure(): Promise<void> {
    if (!this.canCreate() || !this.title().trim() || !this.systemId() || this.workspace.saving()) return;
    const id = this.newAdventureId;
    if (
      await this.workspace.save({ action: 'createAdventure', id, title: this.title(), source: '', systemId:this.systemId() })
    ) {
      this.newAdventureId = crypto.randomUUID();
      await this.router.navigate(['/tavolo-da-gioco/gdr/gestione', id], {queryParams: {sezione: 'avventura'}});
    }
  }
}
