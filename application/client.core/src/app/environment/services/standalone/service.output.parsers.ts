import * as Toolkit from 'chipmunk.client.toolkit';

import { Observable, Subject } from 'rxjs';
import { ComponentFactory, ModuleWithComponentFactories } from '@angular/core';
import { shadeColor, scheme_color_4, scheme_color_0, getContrastColor } from '../../theme/colors';
import { CColors } from '../../conts/colors';
import { FilterRequest } from '../../controller/controller.session.tab.search.filters.request';
import { ControllerSessionTab } from '../../controller/controller.session.tab';
import { Subscription } from 'rxjs';

import EventsSessionService from '../../services/standalone/service.events.session';

export interface IRequest {
    reg: RegExp;
    color: string | undefined;
    background: string | undefined;
}

export interface IRow {
    str: string;
    pluginId?: number;
    source?: string;
    position?: number;
    hasOwnStyles?: boolean;
}

export interface ITooltip {
    id: string;
    getContent(str: string, position: number, selection: string): Promise<string | undefined>;
}

interface ICachedKey {
    key: string;
    regExp: RegExp;
}

const TOOLTIP_ATTR_NAME = 'data-row-tooltip';

export class OutputParsersService {

    private _logger: Toolkit.Logger = new Toolkit.Logger('OutputParsersService');
    private _parsers: {
        bound: Map<number, Toolkit.ARowBoundParser>,
        common: Map<number, Toolkit.ARowCommonParser>,
        typed: Map<number, Toolkit.ARowTypedParser>,
        session: Map<string, Map<string, Toolkit.ARowCommonParser>>,
        tooltips: Map<string, Map<string, ITooltip>>,
    } = {
        bound: new Map(),
        common: new Map(),
        typed: new Map(),
        session: new Map(),
        tooltips: new Map(),
    };
    private _search: Map<string, IRequest[]> = new Map();
    private _charts: Map<string, IRequest[]> = new Map();
    private _highlights: Map<string, IRequest[]> = new Map();
    private _typedRowRenders: Map<string, Toolkit.ATypedRowRender<any>> = new Map();
    private _subscriptions: { [key: string]: Subscription } = {};
    private _sessionSubscriptions: { [key: string]: Subscription } = {};
    private _session: string;
    private _typedRowRendersHistory: {
        sources: string[],
        aliases: Map<string, string>,
    } = {
        sources: [],
        aliases: new Map(),
    };
    private _subjects: {
        onUpdatedSearch: Subject<void>,
        onRepain: Subject<void>,
    } = {
        onUpdatedSearch: new Subject<void>(),
        onRepain: new Subject<void>(),
    };
    private _cache: { [key: string]: ICachedKey } = {};

    constructor() {
        this._subscriptions.onSessionChange = EventsSessionService.getObservable().onSessionChange.subscribe(
            this._onSessionChange.bind(this),
        );
        this._subscriptions.onSessionClosed = EventsSessionService.getObservable().onSessionClosed.subscribe(
            this._onSessionClosed.bind(this),
        );
    }

    public destroy() {
        Object.keys(this._subscriptions).forEach((key: string) => {
            this._subscriptions[key].unsubscribe();
        });
    }

    public getObservable(): {
        onUpdatedSearch: Observable<void>,
        onRepain: Observable<void>,
    } {
        return {
            onUpdatedSearch: this._subjects.onUpdatedSearch.asObservable(),
            onRepain: this._subjects.onRepain.asObservable(),
        };
    }

    public setParsers(exports: Toolkit.IPluginExports, pluginId: number, mwcf?: ModuleWithComponentFactories<any>) {
        if (typeof exports !== 'object' || exports === null) {
            return new Error(this._logger.warn(`Fail to setup parser because module isn't an object.`));
        }
        // Check plugin's parsers
        this._setBoundParsers(exports, pluginId);
        // Check common
        this._setCommonParsers(exports, pluginId);
        // Check typed parsers
        this._setTypedParsers(exports, pluginId);
        // Check row components
        this._setTypedRowExternalComponent(exports, mwcf);
        // Check custom row renders
        this._setTypedCustomRowRender(exports);
    }

    public setSearchResults(sessionId: string, requests: FilterRequest[] ) {
        this._search.set(sessionId, requests.map((request: FilterRequest) => {
            return {
                reg: request.asRegExp(),
                color: request.getColor(),
                background: request.getBackground(),
            };
        }));
        this._subjects.onUpdatedSearch.next();
    }

    public setHighlights(sessionId: string, requests: FilterRequest[]) {
        this._highlights.set(sessionId, requests.map((request: FilterRequest) => {
            return {
                reg: request.asRegExp(),
                color: request.getColor(),
                background: request.getBackground(),
            };
        }));
    }

    public setCharts(sessionId: string, requests: IRequest[]) {
        this._charts.set(sessionId, requests.map((request: IRequest) => {
            return {
                reg: new RegExp(this.serialize(request.reg.source), request.reg.flags),
                color: request.color !== undefined ? getContrastColor(request.color, true) : undefined,
                background: request.color,
            };
        }));
    }

    public unsetSearchResults(sessionId: string) {
        this._search.delete(sessionId);
        this._subjects.onUpdatedSearch.next();
    }

    public unsetChartsResults(sessionId: string) {
        this._charts.delete(sessionId);
    }

    public getTypedRowRender(sourceName: string, sourceMeta?: string): Toolkit.ATypedRowRender<any> | undefined {
        return this._getTypedRowRenderBySource(sourceName, sourceMeta);
    }

    public row(row: IRow): string {
        const rowInfo: Toolkit.IRowInfo = {
            sourceName: row.source,
            position: row.position,
            hasOwnStyles: row.hasOwnStyles,
        };
        // Apply bound parsers
        const bound: Toolkit.ARowBoundParser | undefined = this._parsers.bound.get(row.pluginId);
        if (bound !== undefined) {
            row.str = bound.parse(row.str, Toolkit.EThemeType.dark, rowInfo);
        }
        // Apply typed parser
        this._parsers.typed.forEach((typed: Toolkit.ARowTypedParser) => {
            if (typed.isTypeMatch(row.source)) {
                row.str = typed.parse(row.str, Toolkit.EThemeType.dark, rowInfo);
            }
        });
        // Apply common parser
        this._parsers.common.forEach((common: Toolkit.ARowCommonParser) => {
            row.str = common.parse(row.str, Toolkit.EThemeType.dark, rowInfo);
        });
        // Apply session parsers
        const parsers: Map<string, Toolkit.ARowCommonParser> | undefined = this._parsers.session.get(this._session);
        if (parsers !== undefined) {
            parsers.forEach((parser: Toolkit.ARowCommonParser) => {
                row.str = parser.parse(row.str, Toolkit.EThemeType.dark, rowInfo);
            });
        }
        return row.str;
    }

    public matches(sessionId: string, row: number, str: string): { str: string, color?: string, background?: string } {
        const map: { [key: string]: { value: string, reg: RegExp} } = {};
        const getReplacedStr = (openWith: string, closeWith: string, replaceWith: string): string => {
            const openKey = this._getCachedKeyForValue(openWith).key;
            const closeKey = this._getCachedKeyForValue(closeWith).key;
            if (map[openKey] === undefined) {
                map[openKey] = {
                    value: openWith,
                    reg: this._getCachedKeyForValue(openWith).regExp,
                };
            }
            if (map[closeKey] === undefined) {
                map[closeKey] = {
                    value: closeWith,
                    reg: this._getCachedKeyForValue(closeWith).regExp,
                };
            }
            return `${openKey}${replaceWith}${closeKey}`;
        };
        const requests: IRequest[] | undefined = this._search.get(sessionId);
        const highlights: IRequest[] = this._highlights.get(sessionId);
        const charts: IRequest[] = this._charts.get(sessionId);
        if (requests === undefined && this._highlights === undefined && charts === undefined) {
            return {
                str: str,
            };
        }
        let first: IRequest | undefined;
        const applied: string[] = [];
        if (highlights instanceof Array || charts instanceof Array) {
            [
                ...(highlights === undefined ? [] : highlights),
                ...(charts === undefined ? [] : charts)
            ].forEach((request: IRequest) => {
                const bgcl: string = request.background === CColors[0] ? scheme_color_4 : (request.background === undefined ? scheme_color_4 : shadeColor(request.background, 30));
                const fgcl: string = getContrastColor(bgcl, true);
                str = str.replace(request.reg, (match: string) => {
                    if (first === undefined) {
                        first = request;
                    }
                    return getReplacedStr(`<span class="noreset match" style="background: ${bgcl}; color: ${fgcl};">`, `</span>`, match);
                });
                applied.push(request.reg.source);
            });
        }
        if (requests instanceof Array) {
            requests.forEach((request: IRequest) => {
                if (applied.indexOf(request.reg.source) !== -1) {
                    return;
                }
                str = str.replace(request.reg, (match: string) => {
                    if (first === undefined) {
                        first = request;
                    }
                    return getReplacedStr(`<span class="noreset match">`, `</span>`, match);
                });
            });
        }
        Object.keys(map).forEach((key: string) => {
            str = str.replace(map[key].reg, map[key].value);
        });
        return {
            str: str,
            color: first === undefined ? undefined : (first.color === CColors[0] ? undefined : first.color),
            background: first === undefined ? undefined : (first.background === CColors[0] ? undefined : first.background)
        };
    }

    public escapeHTML(html: string): string {
        return html.replace(/<.*?>/gi, '');
    }

    public updateRowsView() {
        this._subjects.onRepain.next();
    }

    public serialize(str: string): string {
        // Serialize input string to prevent brocken HTML
        return str.replace(/</gi, '&lt;').replace(/>/gi, '&gt;');
    }

    public setSessionParser(id: string, parser: Toolkit.RowCommonParser, session?: string, update: boolean = false) {
        if (this._session === undefined && session === undefined) {
            return;
        }
        session = session === undefined ? this._session : session;
        let parsers: Map<string, Toolkit.RowCommonParser> | undefined = this._parsers.session.get(session);
        if (parsers === undefined) {
            parsers = new Map();
        }
        parsers.set(id, parser);
        this._parsers.session.set(session, parsers);
        if (update) {
            this.updateRowsView();
        }
    }

    public removeSessionParser(id: string, session?: string, update: boolean = false) {
        if (this._session === undefined && session === undefined) {
            return;
        }
        session = session === undefined ? this._session : session;
        const parsers: Map<string, Toolkit.RowCommonParser> | undefined = this._parsers.session.get(session);
        if (parsers === undefined) {
            return;
        }
        parsers.delete(id);
        this._parsers.session.set(session, parsers);
        if (update) {
            this.updateRowsView();
        }
    }

    public setSessionTooltip(tooltip: ITooltip, session?: string) {
        if (this._session === undefined && session === undefined) {
            return;
        }
        session = session === undefined ? this._session : session;
        let tooltips: Map<string, ITooltip> | undefined = this._parsers.tooltips.get(session);
        if (tooltips === undefined) {
            tooltips = new Map();
        }
        tooltips.set(tooltip.id, tooltip);
        this._parsers.tooltips.set(session, tooltips);
    }

    public getTooltipHook(id: string): string {
        return ` ${TOOLTIP_ATTR_NAME}="${id}" `;
    }

    public getTooltipContent(target: HTMLElement, str: string, position: number): Promise<string | undefined> {
        return new Promise((resolve) => {
            const tooltips: Map<string, ITooltip> | undefined = this._parsers.tooltips.get(this._session);
            if (tooltips === undefined) {
                return resolve(undefined);
            }
            if (target === undefined || target === null) {
                return resolve(undefined);
            }
            const id: string | null | undefined = target.getAttribute(TOOLTIP_ATTR_NAME);
            if (id === null || id === undefined) {
                return resolve(undefined);
            }
            const tooltip: ITooltip | undefined = tooltips.get(id);
            if (tooltip === undefined) {
                return resolve(undefined);
            }
            tooltip.getContent(str, position, target.innerHTML).then((out: string) => {
                resolve(out);
            }).catch((err: Error) => {
                this._logger.warn(`Fail get tooltip value due error: ${err.message}`);
            });
        });
    }

    private _setBoundParsers(exports: Toolkit.IPluginExports, pluginId: number): boolean {
        if (pluginId === undefined || this._parsers.bound.has(pluginId)) {
            return false;
        }
        const parser: Toolkit.ARowBoundParser | undefined = this._findExportEntity(exports, Toolkit.ARowBoundParser);
        if (parser === undefined) {
            return false;
        }
        this._parsers.bound.set(pluginId, parser);
        return true;
    }

    private _onSessionChange(controller?: ControllerSessionTab) {
        Object.keys(this._sessionSubscriptions).forEach((key: string) => {
            this._sessionSubscriptions[key].unsubscribe();
        });
        if (controller === undefined) {
            return;
        }
        if (!this._parsers.session.has(controller.getGuid())) {
            this._parsers.session.set(controller.getGuid(), new Map());
        }
        if (!this._parsers.tooltips.has(controller.getGuid())) {
            this._parsers.tooltips.set(controller.getGuid(), new Map());
        }
        this._session = controller.getGuid();
    }

    private _onSessionClosed(guid: string) {
        this._parsers.session.delete(guid);
        this._parsers.tooltips.delete(guid);
    }

    private _setCommonParsers(exports: Toolkit.IPluginExports, pluginId: number) {
        if (pluginId === undefined || this._parsers.common.has(pluginId)) {
            return false;
        }
        const parser: Toolkit.ARowCommonParser | undefined = this._findExportEntity(exports, Toolkit.ARowCommonParser);
        if (parser === undefined) {
            return false;
        }
        this._parsers.common.set(pluginId, parser);
        return true;
    }

    private _setTypedParsers(exports: Toolkit.IPluginExports, pluginId: number) {
        if (pluginId === undefined || this._parsers.typed.has(pluginId)) {
            return false;
        }
        const parser: Toolkit.ARowTypedParser | undefined = this._findExportEntity(exports, Toolkit.ARowTypedParser);
        if (parser === undefined) {
            return false;
        }
        this._parsers.typed.set(pluginId, parser);
        return true;
    }

    private _findExportEntity(exports: Toolkit.IPluginExports, classDef: any): any {
        let result: Toolkit.TPluginExportEntity | undefined;
        Object.keys(exports).forEach((key: string) => {
            const entity: Toolkit.TPluginExportEntity = exports[key];
            if (result !== undefined) {
                return;
            }
            if ((typeof classDef.isInstance === 'function' && classDef.isInstance(entity)) || entity instanceof classDef) {
                result = entity;
            }
        });
        return result;
    }

    private _setTypedRowExternalComponent(exports: Toolkit.IPluginExports, mwcf: ModuleWithComponentFactories<any>) {
        if (mwcf === undefined) {
            return;
        }
        const render: Toolkit.ATypedRowRender<Toolkit.ATypedRowRenderAPIExternal> = this._getTypedRowRender(exports);
        if (render === undefined) {
            return;
        }
        if (render.getType() !== Toolkit.ETypedRowRenders.external) {
            return;
        }
        if (!(render.getAPI() instanceof Toolkit.ATypedRowRenderAPIExternal)) {
            this._logger.error(`Fail to set external render for row, because plugin doesn't have API<ATypedRowRenderAPIExternal> `);
            return;
        }
        const selector: string = render.getAPI().getSelector();
        // Try to find component factory
        const factory: ComponentFactory<any> | undefined = mwcf.componentFactories.find(e => e.selector === selector);
        if (factory === undefined) {
            this._logger.warn(`Fail to find factory by selector "${selector}"`);
            return;
        }
        render.getAPI().setFactory(factory);
        this._typedRowRenders.set(Toolkit.guid(), render);
    }

    private _setTypedCustomRowRender(exports: Toolkit.IPluginExports) {
        const render: Toolkit.ATypedRowRender<Toolkit.ATypedRowRenderAPIColumns> = this._getTypedRowRender(exports);
        if (render === undefined) {
            return;
        }
        if (render.getType() === Toolkit.ETypedRowRenders.external) {
            return;
        }
        const CTypedRowAPITable = {
            [Toolkit.ETypedRowRenders.columns]: Toolkit.ATypedRowRenderAPIColumns,
        };
        if (CTypedRowAPITable[render.getType()] === undefined) {
            this._logger.error(`Fail to find expected class for typed row render.`);
            return;
        }
        if (!(render.getAPI() instanceof CTypedRowAPITable[render.getType()])) {
            this._logger.error(`Fail to set external render for row, because plugin doesn't have API<${CTypedRowAPITable[render.getType()].name}> `);
            return;
        }
        this._typedRowRenders.set(Toolkit.guid(), render);
    }

    private _getTypedRowRender(exports: Toolkit.IPluginExports): Toolkit.ATypedRowRender<any> | undefined {
        let render: Toolkit.ATypedRowRender<any> | undefined;
        Object.keys(exports).forEach((key: string) => {
            if (exports[key] instanceof Toolkit.ATypedRowRender) {
                render = exports[key] as Toolkit.ATypedRowRender<any>;
            }
        });
        return render;
    }

    private _getTypedRowRenderBySource(sourceName: string, sourceMeta?: string): Toolkit.ATypedRowRender<any> | undefined {
        const hash: string = sourceName + (typeof sourceMeta === 'string' ? sourceMeta : '');
        if (this._typedRowRendersHistory.sources.indexOf(hash) !== -1) {
            const storedGuid: string | undefined = this._typedRowRendersHistory.aliases.get(hash);
            if (storedGuid === undefined) {
                return undefined;
            }
            return this._typedRowRenders.get(storedGuid);
        }
        this._typedRowRendersHistory.sources.push(hash);
        let guid: string | undefined;
        this._typedRowRenders.forEach((typedRowComponent: any, alias: string) => {
            if (typedRowComponent.isTypeMatch(sourceName, sourceMeta)) {
                guid = alias;
            }
        });
        if (guid === undefined) {
            return undefined;
        }
        this._typedRowRendersHistory.aliases.set(hash, guid);
        return this._typedRowRenders.get(guid);
    }

    private _getCachedKeyForValue(value: string): ICachedKey {
        if (this._cache[value] === undefined) {
            const key: string = Toolkit.guid();
            this._cache[value] = {
                key: key,
                regExp: new RegExp(key, 'gi'),
            };

        }
        return this._cache[value];
    }

}

export default (new OutputParsersService());
