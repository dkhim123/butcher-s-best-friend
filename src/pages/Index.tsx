import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/butchery/Header";
import { SaleEntry } from "@/components/butchery/SaleEntry";
import { ProductsManager } from "@/components/butchery/ProductsManager";
import { OpeningStock } from "@/components/butchery/OpeningStock";
import { DailyReport } from "@/components/butchery/DailyReport";
import { ShoppingCart, Package, Beef, BarChart3 } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6">
        <Tabs defaultValue="sale" className="space-y-6">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full sm:w-auto h-auto p-1">
            <TabsTrigger value="sale" className="gap-2 py-2.5">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Sell</span>
            </TabsTrigger>
            <TabsTrigger value="stock" className="gap-2 py-2.5">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Stock</span>
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-2 py-2.5">
              <Beef className="h-4 w-4" />
              <span className="hidden sm:inline">Products</span>
            </TabsTrigger>
            <TabsTrigger value="report" className="gap-2 py-2.5">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Report</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sale"><SaleEntry /></TabsContent>
          <TabsContent value="stock"><OpeningStock /></TabsContent>
          <TabsContent value="products"><ProductsManager /></TabsContent>
          <TabsContent value="report"><DailyReport /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
