import { Component, OnDestroy, ChangeDetectorRef, AfterContentInit, Input, ViewChild } from '@angular/core';
import { SidebarAppSearchManagerListDirective } from '../../directives/list.directive';
import { ChartRequest } from '../../../../../controller/controller.session.tab.search.charts.request';
import { Subscription } from 'rxjs';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Provider } from '../../providers/provider';
import { Entity } from '../../providers/entity';

import SearchManagerService, { EListID } from '../../service/service';

@Component({
    selector: 'app-sidebar-app-searchmanager-charts',
    templateUrl: './template.html',
    styleUrls: ['./styles.less']
})

export class SidebarAppSearchManagerChartsComponent implements OnDestroy, AfterContentInit {

    @Input() provider: Provider<ChartRequest>;

    @ViewChild(SidebarAppSearchManagerListDirective) listDirective: SidebarAppSearchManagerListDirective;

    public _ng_entries: Array<Entity<ChartRequest>> = [];
    public _ng_listID: EListID = EListID.chartsList;

    private _subscriptions: { [key: string]: Subscription } = {};
    private _destroyed: boolean = false;

    constructor(private _cdRef: ChangeDetectorRef) {
    }

    public ngOnDestroy() {
        this._destroyed = true;
        Object.keys(this._subscriptions).forEach((key: string) => {
            this._subscriptions[key].unsubscribe();
        });
    }

    public ngAfterContentInit() {
        this._ng_entries = this.provider.get();
        this._subscriptions.change = this.provider.getObservable().change.subscribe(this._onDataUpdate.bind(this));
    }

    public _ng_onItemDragged(event: CdkDragDrop<ChartRequest[]>) {
        SearchManagerService.onDragStart(false);
        if (this.listDirective.droppedOut) {
            return;
        }
        const prev = event.previousContainer;
        const index = event.previousIndex;
        if (prev.data !== undefined && (prev.data as any).disabled !== undefined) {
            const outside: Entity<any> | undefined = (prev.data as any).disabled[event.previousIndex] !== undefined ? (prev.data as any).disabled[index] : undefined;
            if (outside !== undefined && typeof outside.getEntity().getEntity === 'function' && outside.getEntity().getEntity() instanceof ChartRequest) {
                this.provider.getSession().getSessionSearch().getDisabledAPI().getStorage().remove(outside.getEntity());
                this.provider.getSession().getSessionSearch().getChartsAPI().getStorage().add(outside.getEntity().getEntity(), event.currentIndex);
            }
        } else {
            this.provider.reorder({ prev: event.previousIndex, curt: event.currentIndex });
        }
    }

    public _ng_onContexMenu(event: MouseEvent, entity: Entity<ChartRequest>) {
        this.provider.select().context(event, entity);
    }

    public _ng_onDoubleClick(event: MouseEvent, entity: Entity<ChartRequest>) {
        this.provider.select().doubleclick(event, entity);
    }

    private _onDataUpdate() {
        this._ng_entries = this.provider.get();
        this._forceUpdate();
    }

    private _forceUpdate() {
        if (this._destroyed) {
            return;
        }
        this._cdRef.detectChanges();
    }

}
