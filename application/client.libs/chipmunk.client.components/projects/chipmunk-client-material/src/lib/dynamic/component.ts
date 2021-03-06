/*
src: http://blog.rangle.io/dynamically-creating-components-with-angular-2/
*/

import { Component, Input, ViewContainerRef, ComponentFactoryResolver, Injector, InjectionToken } from '@angular/core';

export interface IComponentDesc {
    factory: any;
    resolved?: boolean;
    inputs?: any;
}

const CCachedFactories: Map<string, any> = new Map();

@Component({
    selector        : 'lib-containers-dynamic',
    entryComponents : [],
    template        : '',
    styles          : [':host { display: none; }'],
})

export class DynamicComponent {

    private _component: any = null;

    @Input() detectChanges = true;
    @Input() alwaysDrop = false;


    @Input() set component(desc: IComponentDesc) {
        if (typeof desc !== 'object' || desc === null) {
            return;
        }
        if (desc.factory === void 0) {
            return;
        }
        if (desc.inputs === void 0) {
            desc.inputs = {};
        }
        if (this._component) {
            // Component already was created
            if (!this.alwaysDrop && typeof this._component.componentType === 'function' && typeof desc.factory === 'function' && this._component.componentType.name === desc.factory.name) {
                // No need to recreate component. Update inputs
                Object.keys(desc.inputs).forEach((key: string) => {
                    this._component.instance[key] = desc.inputs[key];
                });
                this._component.hostView.detectChanges();
                return;
            } else {
                this._component.destroy();
            }
        }
        let component;
        if (!desc.resolved) {
            // Factory of component isn't resolved
            const name: string = desc.factory.name;
            let factory = CCachedFactories.get(name);
            if (factory === undefined || typeof name !== 'string' || name.trim() === '') {
                const inputProviders = Object.keys(desc.inputs).map((inputName) => {
                    const token = new InjectionToken<any>(inputName);
                    return { provide: token, useValue: desc.inputs[inputName] };
                });
                const injector = Injector.create({
                    providers: inputProviders,
                    parent: this.viewContainerRef.injector,
                });
                factory = this.resolver.resolveComponentFactory(desc.factory);
                component = factory.create(injector);
                CCachedFactories.set(name, { factory: factory, injector: injector });
            } else {
                component = factory.factory.create(factory.injector);
            }
            Object.keys(desc.inputs).forEach((key: string) => {
                component.instance[key] = desc.inputs[key];
            });
            this.viewContainerRef.insert(component.hostView);
            if (this.detectChanges)  {
                component.hostView.detectChanges();
            }
        } else {
            // Factory of component is already resolved
            component = this.viewContainerRef.createComponent(desc.factory);
            Object.keys(desc.inputs).forEach((inputName) => {
                component.instance[inputName] = desc.inputs[inputName];
            });
        }
        this._component = component;
    }

    constructor(
        private resolver: ComponentFactoryResolver,
        private viewContainerRef: ViewContainerRef) {
    }

}
